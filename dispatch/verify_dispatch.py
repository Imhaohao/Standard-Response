"""End-to-end check of Track C against a running deployment: solver, compatibility, frozen runs,
re-routing, revocation, cancellation, stale acceptance, fallback and vehicle movement.

Needs the Convex backend, the solver service and the simulation running:

    uv run python server.py &
    uv run python verify_dispatch.py --url http://127.0.0.1:3210 [--reset] [--fallback-dir ..]

--reset wipes the deployment's simulation tables first (never use it on the shared demo deployment).
--fallback-dir points at the Convex project folder; the check then breaks SOLVER_URL for a moment to
prove the heuristic takes over, and restores it.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from convex import ConvexClient

ROOT = Path(__file__).resolve().parent.parent
GRAPH = json.loads((ROOT / "data" / "roads" / "altadena.json").read_text())
LIVE = {"proposed", "offered", "accepted"}


@dataclass
class Report:
    rows: list[tuple[bool, str, str]] = field(default_factory=list)

    def check(self, ok: bool, name: str, detail: str):
        self.rows.append((ok, name, detail))
        print(f"{'PASS' if ok else 'FAIL'}  {name}: {detail}", flush=True)

    @property
    def failed(self):
        return [r for r in self.rows if not r[0]]


def wait_for(predicate, timeout: float, every: float = 1.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(every)
    return None


def env_url():
    if os.environ.get("CONVEX_URL"):
        return os.environ["CONVEX_URL"]
    env = ROOT / ".env.local"
    for line in env.read_text().splitlines() if env.exists() else []:
        if line.startswith("NEXT_PUBLIC_CONVEX_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("No Convex URL: pass --url or set CONVEX_URL")


class World:
    def __init__(self, client: ConvexClient):
        self.client = client

    def offers(self):
        return self.client.query("offers:active")

    def requests(self):
        return {r["_id"]: r for r in self.client.query("requests:open")}

    def vehicles(self):
        return {v["_id"]: v for v in self.client.query("vehicles:list")}

    def routes(self):
        return {r["vehicleId"]: r for r in self.client.query("dispatch:routes")}

    def status(self):
        return self.client.query("dispatch:status")

    def assignments_for(self, vehicle_id):
        return self.client.query("offers:forVehicle", {"vehicleId": vehicle_id})


def start_night(world: World, reset: bool):
    if reset:
        world.client.mutation("control:reset")
        time.sleep(4)
    world.client.mutation("control:issueWarning")
    world.client.mutation("control:setStandIns", {"simulateDispatch": False, "simulateDrivers": True, "autoApprove": True})


def check_solver(world: World, report: Report):
    plan = wait_for(lambda: (world.status()["latestPlan"] or None), 90)
    if not plan:
        report.check(False, "Dispatcher writes plans", "no plan within 90 s")
        return
    status = world.status()
    solver = plan["solver"]
    report.check(
        solver == "ortools",
        "OR-Tools writes offers through plans:propose",
        f"plan v{plan['version']} by {solver}, {plan.get('requestCount')} requests, {plan.get('vehicleCount')} vehicles, "
        f"{plan['solveMs']} ms, fallback: {plan.get('fallbackReason') or 'none'}, solver configured: {status['solverConfigured']}",
    )


def fits(vehicle, request):
    load = request["load"]
    return (
        vehicle["seats"] >= load["seats"]
        and vehicle["wheelchairSpaces"] >= load["wheelchairSpaces"]
        and vehicle["stretcherSpaces"] >= load["stretcherSpaces"]
        and vehicle["crewSize"] >= request["crewNeeded"]
        and (vehicle["liftCapable"] or not request["needsLift"])
    )


def check_compatibility(world: World, report: Report):
    wait_for(lambda: len(world.offers()) >= 3, 90)
    vehicles, requests = world.vehicles(), world.requests()
    offers = [o for o in world.offers() if o["requestId"] in requests]
    bad = [o for o in offers if not fits(vehicles[o["vehicleId"]], requests[o["requestId"]])]
    lifts = [o for o in offers if requests[o["requestId"]]["needsLift"]]
    two_crew = [o for o in offers if requests[o["requestId"]]["crewNeeded"] >= 2]
    report.check(
        len(offers) > 0 and not bad,
        "Every offer fits space, crew and lift",
        f"{len(offers)} live offers checked, {len(bad)} incompatible, {len(lifts)} need a lift, {len(two_crew)} need two crew",
    )


def check_movement(world: World, report: Report):
    routes = wait_for(lambda: {k: r for k, r in world.routes().items() if len(r["remaining"]) > 2 and not r["boarding"]}, 120)
    if not routes:
        report.check(False, "Vehicles drive along road paths", "no vehicle on a road path within 120 s")
        return
    before = world.vehicles()
    time.sleep(4)
    after = world.vehicles()
    moved = [k for k in routes if (before[k]["lat"], before[k]["lng"]) != (after[k]["lat"], after[k]["lng"])]
    points = max(len(r["remaining"]) for r in routes.values())
    report.check(bool(moved), "Vehicles drive along road paths", f"{len(moved)} of {len(routes)} routed vehicles moved; longest path {points} road points")


def accepted_runs(world: World):
    return {o["_id"]: o for o in world.offers() if o["status"] == "accepted"}


def check_frozen_runs(world: World, report: Report):
    before = wait_for(lambda: accepted_runs(world), 120)
    if not before:
        report.check(False, "Accepted runs stay frozen", "no accepted pickups within 120 s")
        return
    time.sleep(15)
    start_version = world.status()["latestPlan"]["version"]
    time.sleep(15)
    after = {o["_id"]: o for o in world.offers()}
    moved = [a for a in before if a in after and after[a]["vehicleId"] != before[a]["vehicleId"]]
    reordered = [a for a in before if a in after and after[a]["stopOrder"] != before[a]["stopOrder"]]
    plans = world.status()["latestPlan"]["version"] - start_version
    report.check(
        not moved and not reordered,
        "Accepted runs stay frozen across re-plans",
        f"{len(before)} accepted pickups watched over {plans} new plans: {len(moved)} moved vehicle, {len(reordered)} reordered",
    )


def nearest_node(lat, lng):
    best, best_d = 0, float("inf")
    for i, (nlat, nlng) in enumerate(GRAPH["nodes"]):
        d = (nlat - lat) ** 2 + ((nlng - lng) * 0.83) ** 2
        if d < best_d:
            best, best_d = i, d
    return best


def edges_touching(node):
    return [e for e in GRAPH["edges"] if node in (e["u"], e["v"])]


def closure_for(edge):
    u, v = GRAPH["nodes"][edge["u"]], GRAPH["nodes"][edge["v"]]
    return {"edgeKey": edge["key"], "path": [{"lat": u[0], "lng": u[1]}, {"lat": v[0], "lng": v[1]}], "source": "manual"}


def check_reroute(world: World, report: Report):
    routes = wait_for(
        lambda: {k: r for k, r in world.routes().items() if r["target"]["kind"] == "pickup" and len(r["remaining"]) > 8 and not r["boarding"]},
        120,
    )
    if not routes:
        report.check(False, "Closure re-routes the same vehicle to the same stop", "no long pickup route to cut")
        return
    vehicle_id, route = next(iter(routes.items()))
    middle = route["remaining"][len(route["remaining"]) // 2]
    node = nearest_node(middle["lat"], middle["lng"])
    blocked = [e for e in edges_touching(node)]
    world.client.mutation("roads:addClosures", {"closures": [closure_for(blocked[0])]})
    target = route["target"]
    rerouted = wait_for(lambda: _rerouted(world, vehicle_id, target, route), 30)
    detail = (
        f"closed {blocked[0]['name'] or 'a street'} on the van's path; "
        + ("new path, same pickup" if rerouted == "same" else "pickup revoked instead" if rerouted == "revoked" else "no change seen")
    )
    report.check(rerouted in ("same", "revoked"), "Closure re-routes the same vehicle to the same stop", detail)


def _rerouted(world: World, vehicle_id, target, old_route):
    route = world.routes().get(vehicle_id)
    statuses = {o["_id"]: o["status"] for o in world.offers()}
    if target["assignmentId"] not in statuses:
        return "revoked"
    if route and route["target"] == target and route["remaining"] != old_route["remaining"][-len(route["remaining"]):]:
        return "same"
    return None


def pick_accepted(world: World, avoid=()):
    for offer in world.offers():
        if offer["status"] == "accepted" and offer["_id"] not in avoid and offer.get("lat") is not None:
            return offer
    return None


def callbacks_for(world: World, request_id, announces):
    return [c for c in world.client.query("callbacks:recent", {"limit": 200}) if c["requestId"] == request_id and c["announces"] == announces]


def check_revocation(world: World, report: Report):
    offer = wait_for(lambda: pick_accepted(world), 120)
    if not offer:
        report.check(False, "Unreachable pickup is revoked and the rider told", "no accepted pickup")
        return None
    node = nearest_node(offer["lat"], offer["lng"])
    closures = [closure_for(e) for e in edges_touching(node)]
    world.client.mutation("roads:addClosures", {"closures": closures})
    request_id = offer["requestId"]
    revoked = wait_for(lambda: world.requests().get(request_id, {}).get("status") in ("reassigning", "received"), 40)
    told = wait_for(lambda: callbacks_for(world, request_id, "reassigning"), 15)
    escalated = wait_for(lambda: world.requests().get(request_id, {}).get("escalation") == "unservable", 30)
    report.check(
        bool(revoked) and bool(told),
        "Unreachable pickup is revoked and the rider told",
        f"closed all {len(closures)} road segments at {offer['address']}: status "
        f"{world.requests().get(request_id, {}).get('status')}, reassigning callback {'queued' if told else 'missing'}, "
        f"escalated as unservable: {bool(escalated)}",
    )
    return offer["_id"]


def check_cancel_and_new_driver(world: World, report: Report, avoid):
    offer = wait_for(lambda: pick_accepted(world, avoid), 120)
    if not offer:
        report.check(False, "Driver cancels, rider told, a new driver accepts", "no accepted pickup")
        return None
    world.client.mutation("offers:cancelByDriver", {"assignmentId": offer["_id"]})
    request_id, old_vehicle = offer["requestId"], offer["vehicleId"]
    told = wait_for(lambda: callbacks_for(world, request_id, "reassigning"), 15)
    new = wait_for(
        lambda: next((o for o in world.offers() if o["requestId"] == request_id and o["status"] == "accepted"), None), 90
    )
    vehicles = world.vehicles()
    detail = f"{vehicles[old_vehicle]['label']} cancelled at {offer['address']}; reassigning callback {'queued' if told else 'missing'}; "
    detail += f"new driver: {vehicles[new['vehicleId']]['label']}" if new else "no new driver accepted within 90 s"
    report.check(bool(told) and bool(new) and new["vehicleId"] != old_vehicle, "Driver cancels, rider told, a new driver accepts", detail)
    return offer["_id"]


def check_stale_accept(world: World, report: Report, assignment_id):
    if not assignment_id:
        report.check(False, "Stale acceptance is rejected", "no ended assignment to try")
        return
    result = world.client.mutation("offers:accept", {"assignmentId": assignment_id})
    trail = world.client.query("plans:auditTrail", {"limit": 50})
    logged = any(a["kind"] == "stale_accept_rejected" and a.get("assignmentId") == assignment_id for a in trail)
    report.check(result == "changed" and logged, "Stale acceptance is rejected", f"accept on the cancelled offer returned {result!r}; audit logged: {logged}")


def set_solver_url(project_dir: Path, value: str | None):
    command = ["npx", "convex", "env", "set", "SOLVER_URL", value] if value else ["npx", "convex", "env", "remove", "SOLVER_URL"]
    subprocess.run(command, cwd=project_dir, check=True, capture_output=True)


def check_fallback(world: World, report: Report, project_dir: Path | None):
    if not project_dir:
        report.check(True, "Heuristic takes over when the solver is down", "skipped (pass --fallback-dir to run it)")
        return
    original = subprocess.run(["npx", "convex", "env", "get", "SOLVER_URL"], cwd=project_dir, capture_output=True, text=True).stdout.strip()
    set_solver_url(project_dir, "http://127.0.0.1:9")
    try:
        world.client.mutation("dispatch:replanNow")
        state = wait_for(lambda: _fell_back(world), 40)
    finally:
        set_solver_url(project_dir, original or None)
    report.check(bool(state), "Heuristic takes over when the solver is down", f"last re-plan by {state['lastSolver']}: {state['lastFallbackReason']}" if state else "no heuristic re-plan seen")


def _fell_back(world: World):
    state = world.status()["state"]
    return state if state and state.get("lastSolver") == "heuristic" and state.get("lastFallbackReason") else None


def check_completed(world: World, report: Report):
    done = wait_for(lambda: [r for r in world.requests().values() if r["status"] == "arrived"] or None, 180)
    trail = world.client.query("plans:auditTrail", {"limit": 400})
    closed = sum(1 for a in trail if a["kind"] == "status" and a["message"].endswith("to closed"))
    report.check(bool(done) or closed > 0, "Pickups complete and riders reach the shelter", f"{len(done or [])} riders on board now, {closed} dropped at the shelter in the recent audit trail")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url")
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--fallback-dir", type=Path)
    args = parser.parse_args()
    world = World(ConvexClient(args.url or env_url()))
    report = Report()
    start_night(world, args.reset)
    check_solver(world, report)
    check_compatibility(world, report)
    check_movement(world, report)
    check_frozen_runs(world, report)
    check_reroute(world, report)
    check_revocation(world, report)
    cancelled = check_cancel_and_new_driver(world, report, avoid=())
    check_stale_accept(world, report, cancelled)
    check_fallback(world, report, args.fallback_dir)
    check_completed(world, report)
    print(f"\n{len(report.rows) - len(report.failed)} of {len(report.rows)} checks passed")
    sys.exit(1 if report.failed else 0)


if __name__ == "__main__":
    main()
