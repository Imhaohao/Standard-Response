"""Door-check fairness tests: write data/door-fairness.json.

Four orderings (our score, our score without the aging term, nearest-first, random) on identical worlds
under four stress scenarios: baseline, 30% of nominations wrong, one neighborhood answering at half the
rate, and an isolated pocket where nobody answers (so its homes have no answered neighbors and smoothing
can't help them). Each cell is SEEDS worlds;
we report the worst-case wait, not only the average, with the range across seeds.
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.door import DEFAULT_TEAMS, DoorConfig  # noqa: E402
from rollcall_d.door_sim import Scenario_, TravelMatrix, alpha_at_start, build_world, simulate  # noqa: E402
from rollcall_d.hazard import Scenario  # noqa: E402
from rollcall_d.paths import CENSUS, DATA  # noqa: E402
from rollcall_d.travel import RoadGraph  # noqa: E402

POLICIES = ["score", "score_no_aging", "nearest", "random"]
SCENARIOS = [
    Scenario_("baseline"),
    Scenario_("30% of nominations wrong", wrong_nominations=0.3),
    Scenario_("north fifth answers at half the rate", slow_area_answer_factor=0.5),
    Scenario_("isolated pocket: nobody answers within 900 m of the northwest edge", silent_pocket_meters=900.0),
]


def spread(values: list[float]) -> dict:
    a = np.array(values)
    return {"mean": round(float(a.mean()), 1), "p5": round(float(np.percentile(a, 5)), 1), "p95": round(float(np.percentile(a, 95)), 1)}


WAIT_EQUIVALENCES = [15.0, 30.0, 60.0, 120.0]


def alpha_sensitivity(population, base_rates, hazard, travel, seeds: int) -> dict:
    """How the aging weight trades worst-case wait against checking needy homes in time (baseline worlds).
    alpha is set so N minutes on the list equals the 90th-percentile need-and-urgency term; 30 is our choice."""
    rows = {}
    for minutes in WAIT_EQUIVALENCES:
        config = DoorConfig(wait_equivalence_minutes=minutes)
        worst, in_time, drive = [], [], []
        for seed in range(seeds):
            world = build_world(random.Random(seed), population, SCENARIOS[0], hazard, travel, base_rates)
            alpha = alpha_at_start(world, travel, list(DEFAULT_TEAMS), config)
            result = simulate(world, "score", travel, list(DEFAULT_TEAMS), random.Random(1000 + seed), alpha)
            worst.append(float(result.wait.max()))
            in_time.append(result.checked_in_time * 100)
            drive.append(result.extra["drivePerCheck"])
        rows[f"{minutes:.0f} min"] = {"worstWait": spread(worst), "needyInTime": spread(in_time), "drivePerCheck": spread(drive),
                                      "chosen": minutes == DoorConfig().wait_equivalence_minutes}
    rows["reading"] = sensitivity_reading(rows)
    return rows


def sensitivity_reading(rows: dict) -> str:
    """One sentence from the numbers: which way the worst wait moves as the aging weight weakens, and the driving behind it."""
    strong, weak = rows[f"{WAIT_EQUIVALENCES[0]:.0f} min"], rows[f"{WAIT_EQUIVALENCES[-1]:.0f} min"]
    worst = (strong["worstWait"]["mean"], weak["worstWait"]["mean"])
    drive = (strong["drivePerCheck"]["mean"], weak["drivePerCheck"]["mean"])
    direction = "shortens" if worst[1] < worst[0] else "lengthens"
    return (f"From the strongest aging weight (15 min) to the weakest (120 min), the worst wait goes {worst[0]:.0f} to {worst[1]:.0f} min "
            f"and driving per check {drive[0]:.1f} to {drive[1]:.1f} min: weakening the aging {direction} the worst wait. With 6 teams for "
            "400 homes the last check comes when the teams get through the list, and aging that pulls a team off its block to an older "
            "entry costs driving.")


def headlines(results: dict) -> list[str]:
    """Plain sentences computed from the numbers, for the screen and the pitch. Nothing typed in by hand."""
    lines = []
    for name, cells in results.items():
        ours, nearest, rand, no_aging = (cells[p] for p in ("score", "nearest", "random", "score_no_aging"))
        lines.append(
            f"{name}: our order checks {ours['needyInTime']['mean']:.0f}% of truly needy homes the fire reaches before their deadline "
            f"(nearest-first {nearest['needyInTime']['mean']:.0f}%, random {rand['needyInTime']['mean']:.0f}%); "
            f"worst wait {ours['worstWait']['mean']:.0f} min (nearest-first {nearest['worstWait']['mean']:.0f}, random {rand['worstWait']['mean']:.0f}, "
            f"ours without aging {no_aging['worstWait']['mean']:.0f})."
        )
    return lines


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=30)
    args = parser.parse_args()
    population = json.loads((DATA / "population.json").read_text())
    base_rates = {b["geoid"]: b["needRate"] for b in json.loads((CENSUS / "base_rates.json").read_text())["blockGroups"]}
    hazard, roads = Scenario.load(), RoadGraph.load()
    travel = TravelMatrix(roads)
    config = DoorConfig()
    results = {}
    for scenario in SCENARIOS:
        cells = {policy: {"worstWait": [], "p95Wait": [], "meanWait": [], "needyInTime": [], "drivePerCheck": [], "isolatedWorst": [], "slowAreaWorst": []}
                 for policy in POLICIES}
        for seed in range(args.seeds):
            world = build_world(random.Random(seed), population, scenario, hazard, travel, base_rates)
            alpha = alpha_at_start(world, travel, list(DEFAULT_TEAMS), config)
            for policy in POLICIES:
                result = simulate(world, policy, travel, list(DEFAULT_TEAMS), random.Random(1000 + seed), alpha)
                cell = cells[policy]
                cell["worstWait"].append(float(result.wait.max()))
                cell["p95Wait"].append(float(np.percentile(result.wait, 95)))
                cell["meanWait"].append(float(result.wait.mean()))
                cell["needyInTime"].append(result.checked_in_time * 100)
                cell["drivePerCheck"].append(result.extra["drivePerCheck"])
                if world.isolated.any():
                    cell["isolatedWorst"].append(float(result.wait[world.isolated].max()))
                if world.slow_area.any():
                    cell["slowAreaWorst"].append(float(result.wait[world.slow_area].max()))
        results[scenario.name] = {policy: {k: spread(v) for k, v in cell.items() if v} for policy, cell in cells.items()}
        print(scenario.name, {p: (results[scenario.name][p]["worstWait"]["mean"], results[scenario.name][p]["needyInTime"]["mean"]) for p in POLICIES})
    sensitivity = alpha_sensitivity(population, base_rates, hazard, travel, args.seeds)
    out = {
        "label": "Door-team simulation on the real west Altadena road graph with synthetic households. Simulated; a policy test, not a forecast.",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "hazard": hazard.metadata.get("name") or hazard.metadata.get("label"),
        "setup": {"teams": len(DEFAULT_TEAMS), "homesOnList": SCENARIOS[0].homes, "knockMinutes": 4, "seeds": args.seeds,
                  "listOpens": "homes join over minutes 15-45 as the reach ladder runs out",
                  "alpha": "set once, as in the live runner: 30 minutes on the list equals the 90th-percentile need-and-urgency term at the start"},
        "metrics": {"worstWait": "longest any home waited, minutes", "p95Wait": "95th percentile wait", "meanWait": "average wait",
                    "needyInTime": "% of homes that truly need help and that the fire reaches, checked before their hazard deadline",
                    "drivePerCheck": "minutes a team drives per home checked",
                    "isolatedWorst": "longest wait among homes with no answered neighbor within 500 m",
                    "slowAreaWorst": "longest wait in the north fifth (answers at half the rate in that scenario)"},
        "ranges": "mean, and 5th to 95th percentile across seeds",
        "results": results,
        "headlines": headlines(results),
        "alphaSensitivity": sensitivity,
    }
    (DATA / "door-fairness.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
