"""Does the need estimate rank the homes that truly need help? Write data/need-model-results.json.

On the synthetic population: everyone is called, homes answer with their `answersPhone` probability,
and the need model scores the homes that didn't answer, which are the ones a door team would visit. We
compare against their true need from the population and report, with ranges across seeds:

  auc             chance a truly needy unreached home outranks one that isn't (0.5 is random)
  brier           mean squared error of the probability (lower is better)
  top10Precision  share of truly needy homes in the top tenth of the list
  calibration     mean estimate over the true rate (1.0 is calibrated)

for the census prior alone, smoothing over a grid of kernel widths and prior strengths, and the chosen
setting with neighbor nominations of which 30% are wrong. This is how the constants in rollcall_d/need.py
were checked. It's a simulation on synthetic households, and the labels say so.
"""

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d import need  # noqa: E402
from rollcall_d.paths import CENSUS, DATA  # noqa: E402
from rollcall_d.population import needs_help  # noqa: E402

KERNELS = [100.0, 250.0, 500.0]
STRENGTHS = [1.0, 3.0, 10.0]
NOMINATION_COVERAGE = 0.10  # nominations reach about 10% of truly needy unreached homes
WRONG_SHARE = 0.30


def auc(scores: np.ndarray, truth: np.ndarray) -> float:
    positives, negatives = scores[truth == 1], scores[truth == 0]
    if len(positives) == 0 or len(negatives) == 0:
        return float("nan")
    ranks = np.argsort(np.argsort(np.concatenate([positives, negatives]))) + 1
    return float((ranks[: len(positives)].sum() - len(positives) * (len(positives) + 1) / 2) / (len(positives) * len(negatives)))


def metrics(p: np.ndarray, truth: np.ndarray) -> dict:
    top = np.argsort(-p)[: max(1, len(p) // 10)]
    return {"auc": auc(p, truth), "brier": float(np.mean((p - truth) ** 2)),
            "top10Precision": float(truth[top].mean()), "calibration": float(p.mean() / max(truth.mean(), 1e-9))}


def world(rng: random.Random, population: list[dict], base: dict[str, float]):
    households, truth_by_id = [], {}
    for i, h in enumerate(population):
        answered = rng.random() < h["answersPhone"]
        truly = needs_help(h)
        outcome = ("needs_ride" if truly else "leaving") if answered else "unknown"
        hid = f"h{i}"
        households.append({"_id": hid, "outcome": outcome, "lat": h["lat"], "lng": h["lng"],
                           "needPrior": base.get(h["blockGroup"], 0.12), "needProbability": 0.0})
        truth_by_id[hid] = 1.0 if truly else 0.0
    return households, truth_by_id


def nominations(rng: random.Random, unreached: list[str], truth: dict[str, float]) -> set[str]:
    needy = [h for h in unreached if truth[h]]
    others = [h for h in unreached if not truth[h]]
    right = rng.sample(needy, max(1, round(len(needy) * NOMINATION_COVERAGE))) if needy else []
    wrong = rng.sample(others, min(len(others), round(len(right) * WRONG_SHARE / (1 - WRONG_SHARE))))
    return set(right) | set(wrong)


def evaluate(households, truth, nominated, smoothing, config) -> dict:
    estimates = need.estimate(households, nominated, smoothing, config)
    ids = list(estimates)
    return metrics(np.array([estimates[i] for i in ids]), np.array([truth[i] for i in ids]))


def spread(values: list[float]) -> dict:
    a = np.array(values)
    return {"mean": round(float(a.mean()), 4), "p5": round(float(np.percentile(a, 5)), 4), "p95": round(float(np.percentile(a, 95)), 4)}


def summarize(runs: list[dict]) -> dict:
    return {k: spread([r[k] for r in runs]) for k in runs[0]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seeds", type=int, default=10)
    args = parser.parse_args()
    population = json.loads((DATA / "population.json").read_text())
    base = {b["geoid"]: b["needRate"] for b in json.loads((CENSUS / "base_rates.json").read_text())["blockGroups"]}
    chosen = need.NeedConfig()
    cells: dict[str, list[dict]] = {"census prior only": [], "chosen + 30%-wrong nominations": []}
    grid_keys = [(k, s) for k in KERNELS for s in STRENGTHS]
    grid: dict[tuple, list[dict]] = {key: [] for key in grid_keys}
    for seed in range(args.seeds):
        rng = random.Random(seed)
        households, truth = world(rng, population, base)
        cells["census prior only"].append(evaluate(households, truth, set(), False, chosen))
        for kernel, strength in grid_keys:
            config = need.NeedConfig(prior_strength=strength, kernel_meters=kernel)
            grid[(kernel, strength)].append(evaluate(households, truth, set(), True, config))
        unreached = [h["_id"] for h in households if h["outcome"] == "unknown"]
        cells["chosen + 30%-wrong nominations"].append(evaluate(households, truth, nominations(rng, unreached, truth), True, chosen))
    sweep = [{"kernelMeters": k, "priorStrength": s, "chosen": (k, s) == (chosen.kernel_meters, chosen.prior_strength), **summarize(grid[(k, s)])}
             for k, s in grid_keys]
    best = max(sweep, key=lambda row: row["auc"]["mean"])
    chosen_row = next(row for row in sweep if row["chosen"])
    prior = summarize(cells["census prior only"])
    out = {
        "label": "Need-model check on the synthetic population (simulated calls, synthetic households). A test of the method, not of real people.",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "setup": {"households": len(population), "seeds": args.seeds, "nominationCoverage": NOMINATION_COVERAGE, "wrongNominationShare": WRONG_SHARE,
                  "scored": "homes that didn't answer, against their true need"},
        "censusPriorOnly": prior,
        "smoothingSweep": sweep,
        "chosen": {"kernelMeters": chosen.kernel_meters, "priorStrength": chosen.prior_strength, "nominationLR": chosen.nomination_lr, **chosen_row},
        "withNominations": summarize(cells["chosen + 30%-wrong nominations"]),
        "readingTheResult": (
            "The synthetic population is fitted per block group and placed at random within it (plus a pull toward care "
            "facilities), so need has no neighbor-scale pattern beyond what the block-group prior already holds. Smoothing "
            "can't beat the prior here by construction; this test can show whether it does harm, not whether it helps on "
            "real streets, where neighbors share building age, income and household type. Calibration below 1 means the "
            "homes that don't answer need help more often than the prior says: not answering is itself evidence of need."
        ),
        "headlines": [
            f"Census prior alone ranks unreached homes at AUC {prior['auc']['mean']:.2f}; with neighbor smoothing (250 m, strength 3) {chosen_row['auc']['mean']:.2f} "
            f"(synthetic households have no neighbor-scale pattern, so this checks harm, not help).",
            f"Estimates run low for unreached homes (calibration {prior['calibration']['mean']:.2f}): homes that don't answer are needier than the census prior.",
            f"Best setting in the sweep: {best['kernelMeters']:.0f} m, strength {best['priorStrength']:.0f}, AUC {best['auc']['mean']:.2f}.",
            f"Adding neighbor nominations, 30% of them wrong: AUC {summarize(cells['chosen + 30%-wrong nominations'])['auc']['mean']:.2f}, "
            f"top-tenth precision {summarize(cells['chosen + 30%-wrong nominations'])['top10Precision']['mean']:.2f}.",
        ],
    }
    (DATA / "need-model-results.json").write_text(json.dumps(out, indent=1))
    print("\n".join(out["headlines"]))
    for row in sweep:
        print(row["kernelMeters"], row["priorStrength"], row["auc"]["mean"], row["brier"]["mean"], row["calibration"]["mean"])


if __name__ == "__main__":
    main()
