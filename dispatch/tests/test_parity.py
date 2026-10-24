"""convex/heuristic.ts (the live fallback) and heuristic.py (the simulator's copy) must agree."""

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

import heuristic

HERE = Path(__file__).resolve().parent


def random_problem(rng: random.Random):
    size = rng.randint(4, 12)
    matrix = [[0 if i == j else (None if rng.random() < 0.05 else rng.randint(60, 900)) for j in range(size)] for i in range(size)]
    shelters = [{"id": f"s{n}", "location": size - 1 - n, "capacity": rng.choice([2, 5, 1200])} for n in range(rng.randint(1, 2))]
    vehicles = [
        {"id": f"v{k}", "location": rng.randrange(size - 2), "availableAt": rng.choice([0, 0, 600]), "endBy": 8 * 3600,
         "seats": rng.choice([1, 4, 20]), "wheelchairSpaces": rng.choice([0, 1, 2]), "stretcherSpaces": rng.choice([0, 1])}
        for k in range(rng.randint(1, 4))
    ]
    requests = []
    for r in range(rng.randint(1, 10)):
        load = {"seats": rng.randint(0, 3), "wheelchairSpaces": rng.choice([0, 0, 1]), "stretcherSpaces": rng.choice([0, 0, 0, 1])}
        load["seats"] = max(load["seats"], 1 if not load["wheelchairSpaces"] and not load["stretcherSpaces"] else 0)
        allowed = [k for k, v in enumerate(vehicles) if all(v[f] >= load[f] for f in load)]
        requests.append({"id": f"r{r}", "location": rng.randrange(size - 2), "load": load, "boardingSeconds": rng.choice([120, 600, 1200]),
                         "deadline": rng.randint(300, 4000), "weight": rng.randint(1, 5), "allowedVehicles": allowed,
                         "openOfferVehicle": None, "maxRideSeconds": rng.choice([None, None, 1500])})
    return {"policy": "heuristic", "locations": [{"lat": 0, "lng": 0}] * size, "matrix": matrix, "vehicles": vehicles,
            "requests": requests, "shelters": shelters, "timeLimitSeconds": 1}


def comparable(solution):
    return {"routes": solution["routes"], "dropped": sorted(solution["dropped"])}


@pytest.mark.skipif(shutil.which("npx") is None, reason="needs node for convex/heuristic.ts")
def test_typescript_and_python_heuristics_make_identical_plans():
    rng = random.Random(7)
    problems = [random_problem(rng) for _ in range(60)]
    result = subprocess.run(["npx", "tsx", str(HERE / "run_ts_heuristic.ts")], input=json.dumps(problems),
                            capture_output=True, text=True, check=True, cwd=HERE.parent.parent)
    typescript = json.loads(result.stdout)
    for problem, ts_solution in zip(problems, typescript):
        assert comparable(ts_solution) == comparable(heuristic.solve(problem)), json.dumps(problem)
