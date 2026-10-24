"""Synthetic population: real ACS PUMS households reweighted to block-group and tract totals.

The standard method (as in PopGen and ActivitySim). Whole PUMS household records are resampled, so
the dangerous combinations (75+, ambulatory difficulty, alone, no car) survive intact instead of being
assembled from independent marginals.

Iterative proportional fitting per block group matches four household controls (households, with a
member 65+, 65+ living alone, no vehicle), and per tract matches people 65+ with a disability (ACS
publishes B18101 only down to tracts).

ACS has no wheelchair, bed or oxygen variables, so the step from ACS disability flags to the evacuation
record (mobility, assistance, oxygen, can-leave) is a stated mapping with assumed rates, below.
"""

import random
from dataclasses import dataclass

import numpy as np

BG_CONTROLS = ["hasMember65", "alone65", "noVehicle"]
IPF_ITERATIONS = 60

MOBILITY_RANK = {"walks": 0, "walker": 1, "manual_wheelchair": 2, "power_wheelchair": 3, "bedbound": 4}


@dataclass
class Record:
    serial: str
    weight: float
    people: int
    vehicles: int
    spanish: bool
    persons: list[dict]

    @property
    def has65(self) -> bool:
        return any(p["age"] >= 65 for p in self.persons)

    @property
    def alone65(self) -> bool:
        return self.people == 1 and self.persons[0]["age"] >= 65

    @property
    def no_vehicle(self) -> bool:
        return self.vehicles == 0

    @property
    def disabled65(self) -> int:
        return sum(1 for p in self.persons if p["age"] >= 65 and p["disability"])

    def attribute(self, control: str) -> bool:
        return {"hasMember65": self.has65, "alone65": self.alone65, "noVehicle": self.no_vehicle}[control]


def ipf(records: list[Record], blockgroups: list[dict], tracts: dict[str, dict]) -> tuple[np.ndarray, dict]:
    """Weights[g, h] for block group g and record h, and the fit (worst relative error per control)."""
    base = np.array([r.weight for r in records], dtype=float)
    flags = {c: np.array([r.attribute(c) for r in records]) for c in BG_CONTROLS}
    disabled = np.array([r.disabled65 for r in records], dtype=float)
    weights = np.zeros((len(blockgroups), len(records)))
    for g, bg in enumerate(blockgroups):
        weights[g] = base / base.sum() * bg["households"]
    tract_rows: dict[str, list[int]] = {}
    for g, bg in enumerate(blockgroups):
        tract_rows.setdefault(bg["tract"], []).append(g)
    for _ in range(IPF_ITERATIONS):
        for g, bg in enumerate(blockgroups):
            for control in BG_CONTROLS:
                _rake_binary(weights[g], flags[control], bg[control], bg["households"])
            total = weights[g].sum()
            if total > 0:
                weights[g] *= bg["households"] / total
        for tract, rows in tract_rows.items():
            target = _tract_share(tracts.get(tract), blockgroups, rows)
            if target is None:
                continue
            current = sum(weights[g] @ disabled for g in rows)
            if current > 0:
                factor = target / current
                for g in rows:
                    weights[g][disabled > 0] *= factor
    return weights, fit_report(weights, flags, disabled, blockgroups, tracts, tract_rows)


def _rake_binary(row: np.ndarray, flag: np.ndarray, target: float, total: float) -> None:
    target = min(max(target, 0.0), total)
    have, rest = row[flag].sum(), row[~flag].sum()
    if have > 0:
        row[flag] *= target / have
    if rest > 0:
        row[~flag] *= (total - target) / rest


def _tract_share(tract: dict | None, blockgroups: list[dict], rows: list[int]) -> float | None:
    """The tract's count of people 65+ with a disability, times the share of the tract's 65+ households that
    live in our block groups. Edge block groups belong to tracts that extend beyond the study area."""
    if not tract or not tract.get("hasMember65"):
        return None
    ours = sum(blockgroups[g]["hasMember65"] for g in rows)
    return tract["disabled65"] * min(ours / tract["hasMember65"], 1.0)


def fit_report(weights, flags, disabled, blockgroups, tracts, tract_rows) -> dict:
    worst = {}
    for control in ["households", *BG_CONTROLS]:
        errors = []
        for g, bg in enumerate(blockgroups):
            fitted = weights[g].sum() if control == "households" else weights[g][flags[control]].sum()
            if bg[control] > 0:
                errors.append(abs(fitted - bg[control]) / bg[control])
        worst[control] = round(max(errors), 4) if errors else 0.0
    tract_errors = []
    for tract, rows in tract_rows.items():
        target = _tract_share(tracts.get(tract), blockgroups, rows)
        if target:
            tract_errors.append(abs(sum(weights[g] @ disabled for g in rows) - target) / target)
    worst["disabled65 (tract)"] = round(max(tract_errors), 4) if tract_errors else 0.0
    return worst


# ---- from ACS flags to the evacuation record (stated assumptions) ------------------------------------

def person_mobility(person: dict, rng: random.Random) -> str:
    """ACS gives ambulatory, self-care and independent-living difficulty, not aids. Assumed splits:
    all three at 75+: bedbound 15%, power chair 15%, manual chair 35%, walker 35%;
    ambulatory plus self-care or independent living: manual chair 30%, power chair 10%, walker 60%;
    ambulatory only: walker 60%, manual chair 10%, cane or none (walks) 30%."""
    if not person["ambulatory"]:
        return "walks"
    roll = rng.random()
    if person["selfCare"] and person["independentLiving"] and person["age"] >= 75:
        return "bedbound" if roll < 0.15 else "power_wheelchair" if roll < 0.30 else "manual_wheelchair" if roll < 0.65 else "walker"
    if person["selfCare"] or person["independentLiving"]:
        return "manual_wheelchair" if roll < 0.30 else "power_wheelchair" if roll < 0.40 else "walker"
    return "walker" if roll < 0.60 else "manual_wheelchair" if roll < 0.70 else "walks"


def assistance_for(mobility: str, self_care: bool, rng: random.Random) -> str:
    if mobility == "bedbound":
        return "two_person_lift"
    if mobility in ("manual_wheelchair", "power_wheelchair"):
        if self_care:
            return "two_person_lift" if rng.random() < 0.3 else "one_person_assist"
        return "one_person_assist" if rng.random() < 0.4 else "none"
    if mobility == "walker" and self_care:
        return "one_person_assist"
    return "none"


OXYGEN_RATE = 0.10  # among people 65+ with an ambulatory difficulty; ACS has no oxygen variable
CAR_TRANSFERABLE = {"walks", "walker", "manual_wheelchair"}


def evacuation_record(record: Record, rng: random.Random) -> dict:
    mobilities = [(person_mobility(p, rng), p) for p in record.persons]
    mobility, needy = max(mobilities, key=lambda mp: MOBILITY_RANK[mp[0]])
    assistance = assistance_for(mobility, needy["selfCare"], rng)
    oxygen = any(p["age"] >= 65 and p["ambulatory"] and rng.random() < OXYGEN_RATE for p in record.persons)
    has_car = record.vehicles > 0
    helpers = [p for p in record.persons if 18 <= p["age"] < 75 and not p["disability"]]
    can_leave = can_leave_for(mobility, oxygen, has_car, bool(helpers), rng)
    oldest = max(p["age"] for p in record.persons)
    hearing = any(p["hearing"] for p in record.persons)
    answers = 0.85 - (0.10 if oldest >= 80 else 0.0) - (0.10 if hearing else 0.0)
    return {
        "age": oldest, "peopleCount": record.people, "mobility": mobility, "assistanceRequired": assistance,
        "medical": ["oxygen"] if oxygen else [], "hasCar": has_car, "canLeave": can_leave,
        "answersPhone": round(answers, 2), "language": "es" if record.spanish else "en", "hearingDifficulty": hearing,
    }


def can_leave_for(mobility: str, oxygen: bool, has_car: bool, helper: bool, rng: random.Random) -> str:
    """A household can leave on its own with a car and an able adult, if the person who needs the most
    help can ride in a car (walker or a folding manual chair). Power chairs and beds need an accessible vehicle."""
    if mobility == "walks" and not oxygen:
        return "yes" if has_car else ("no" if rng.random() < 0.7 else "unsure")
    if has_car and helper and mobility in CAR_TRANSFERABLE and not oxygen:
        return "yes"
    return "no" if rng.random() < 0.75 else "unsure"


def needs_help(evac: dict) -> bool:
    return evac["canLeave"] != "yes" or evac["mobility"] in ("power_wheelchair", "bedbound") or bool(evac["medical"])
