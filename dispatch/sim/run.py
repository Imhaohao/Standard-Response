"""Command line: uv run python -m sim.run --seeds 100   (or --quick)"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import time
from datetime import datetime, timezone

from .aggregate import comparison, headline, policy_block, todays_headline
from .constants import LABEL, RESULTS_FILE, Config, assumptions_table
from .engine import POLICIES, run_policies
from .metrics import LOWER_IS_BETTER, METRIC_DEFINITIONS
from .population import population_source
from .sensitivity import SENSITIVITY_POLICIES, build_sensitivity, dont_help_line, sensitivity_tasks
from .world import build_world

MAIN_POLICIES = list(POLICIES)
QUICK_SEEDS, QUICK_SENSITIVITY_SEEDS = 5, 1


def seed_task(task):
    key, level, seed, config, names = task
    return key, level, seed, run_policies(build_world(seed, config), names)


def run_tasks(tasks: list, workers: int) -> list:
    with mp.get_context("spawn").Pool(workers) as pool:
        return list(pool.imap_unordered(seed_task, tasks, chunksize=1))


def collect(outputs: list, key_of) -> dict:
    grouped: dict = {}
    for key, level, seed, result in sorted(outputs, key=lambda o: (str(o[0]), o[1], o[2])):
        grouped.setdefault(key_of(key, level), []).append(result)
    return grouped


def runs_of(results: list[dict], name: str) -> list[dict]:
    return [r[name] for r in results]


def build_results(main: list[dict]) -> dict:
    seeds = len(main)
    heuristic, ortools = runs_of(main, "heuristic_outreach"), runs_of(main, "ortools_outreach")
    alns = runs_of(main, "alns_outreach")
    heuristic_911, today = runs_of(main, "heuristic_911"), runs_of(main, "today_911")
    dispatch = comparison(heuristic, ortools, "heuristic", "ortools")
    outreach = comparison(heuristic_911, heuristic, "today911Requests", "ourOutreachRequests")
    combined = comparison(today, ortools, "today", "ours")
    dispatch["headline"] = headline(dispatch, "heuristic", "ortools", seeds, "Dispatch only, identical requests at identical times")
    dispatch_alns = comparison(heuristic, alns, "heuristic", "alns")
    dispatch_alns["headline"] = headline(dispatch_alns, "heuristic", "alns", seeds, "Dispatch only (ALNS), identical requests at identical times")
    alns_vs_ortools = comparison(ortools, alns, "ortools", "alns")
    alns_vs_ortools["headline"] = headline(alns_vs_ortools, "ortools", "alns", seeds, "ALNS against OR-Tools, identical requests at identical times")
    outreach["headline"] = headline(outreach, "today911Requests", "ourOutreachRequests", seeds, "Outreach only, heuristic dispatcher on both sides")
    combined["headline"] = headline(combined, "today", "ours", seeds, "Combined, today's process against outreach plus the optimizer")
    today_block = policy_block(today)
    return {
        "dispatchOnly": dispatch, "dispatchOnlyAlns": dispatch_alns, "alnsVsOrtools": alns_vs_ortools,
        "outreachOnly": outreach, "combined": combined,
        "todayProcess": {"metrics": today_block, "headline": todays_headline(today_block, seeds)},
    }


def integrity_summary(main: list[dict]) -> dict:
    flat = [run for result in main for run in result.values()]
    paired_streams = all(
        r["heuristic_outreach"]["streamDigest"] == r["ortools_outreach"]["streamDigest"] == r["alns_outreach"]["streamDigest"]
        and r["heuristic_911"]["streamDigest"] == r["today_911"]["streamDigest"] for r in main
    )
    return {
        "dispatchOnlyStreamsIdentical": paired_streams,
        "compatibilityViolations": sum(r["compatibilityViolations"] for r in flat),
        "capacityViolations": sum(r["capacityViolations"] for r in flat),
    }


def assemble(main: list[dict], sensitivity_runs: dict, config: Config, elapsed: float, exploration: dict | None) -> dict:
    entries = build_sensitivity(sensitivity_runs)
    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "label": LABEL,
        "seeds": len(main),
        "runtimeSeconds": round(elapsed),
        "population": {"source": population_source(), "households": config.households,
                       "note": "The simulator evaluates a policy on a fictional night. It does not validate predictions about real households."},
        "assumptions": assumptions_table(config),
        "metricDefinitions": METRIC_DEFINITIONS,
        "metricsWhereLowerIsBetter": sorted(LOWER_IS_BETTER),
        "integrity": integrity_summary(main),
        "results": build_results(main),
        "sensitivity": entries,
        "sensitivitySeeds": entries[0]["seeds"] if entries else 0,
        "whereWeDontHelp": dont_help_line(entries) if entries else "",
    }
    if exploration is not None:
        output["exploration"] = exploration
    return output


def parse_args():
    parser = argparse.ArgumentParser(description="Evacuation dispatch simulator")
    parser.add_argument("--seeds", type=int, default=100)
    parser.add_argument("--sensitivity-seeds", type=int, default=20)
    parser.add_argument("--quick", action="store_true", help="about 5 seeds; finishes in under a minute")
    parser.add_argument("--workers", type=int, default=max(mp.cpu_count() - 1, 1))
    parser.add_argument("--out", default=str(RESULTS_FILE))
    parser.add_argument("--no-exploration", action="store_true")
    parser.add_argument("--households", type=int, default=Config.households)
    parser.add_argument("--solver-limit", type=float, default=Config.solver_time_limit_s, help="OR-Tools and ALNS seconds per re-plan")
    return parser.parse_args()


def main():
    args = parse_args()
    seeds = QUICK_SEEDS if args.quick else args.seeds
    sensitivity_seeds = QUICK_SENSITIVITY_SEEDS if args.quick else args.sensitivity_seeds
    base, started = Config(households=args.households, solver_time_limit_s=args.solver_limit), time.time()
    tasks = [("main", 0, seed, base, MAIN_POLICIES) for seed in range(seeds)]
    for key, level, seed, config in sensitivity_tasks(base, list(range(sensitivity_seeds))):
        tasks.append((key, level, seed, config, SENSITIVITY_POLICIES))
    tasks.sort(key=lambda t: (t[0] != "main"))
    outputs = run_tasks(tasks, args.workers)
    main_runs = collect([o for o in outputs if o[0] == "main"], lambda k, lv: "main")["main"]
    sensitivity_runs = collect([o for o in outputs if o[0] != "main"], lambda k, lv: (k, lv))
    exploration = None
    if not args.no_exploration:
        from .exploration import run_exploration
        exploration = run_exploration(sensitivity_seeds, base, args.workers)
    results = assemble(main_runs, sensitivity_runs, base, time.time() - started, exploration)
    with open(args.out, "w") as handle:
        json.dump(results, handle, indent=2, allow_nan=False)
    print(f"wrote {args.out} in {time.time() - started:.0f}s")
    for name in ("dispatchOnly", "dispatchOnlyAlns", "alnsVsOrtools", "outreachOnly", "combined"):
        print(results["results"][name]["headline"])
    print(results["results"]["todayProcess"]["headline"])
    print(results["whereWeDontHelp"])


if __name__ == "__main__":
    main()
