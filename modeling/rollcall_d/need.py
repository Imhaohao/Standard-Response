"""Need estimate p_h: the chance a household needs help getting out.

Order of evidence, strongest first:
  1. Known need from a call or text: needs a ride or an accessible vehicle -> 1. Said they can leave -> small.
  2. A neighbor nomination raises the odds sharply (likelihood ratio NOMINATION_LR).
  3. Otherwise the prior: the rider list (mobility on file) or the census base rate for the block group.
  4. Optional spatial smoothing toward what answered neighbors said (the on-screen toggle).

Every constant is stated and defended here, because each one will be asked about.
"""

from dataclasses import dataclass

import numpy as np

from .geo import to_xy

NEEDS_HELP = {"needs_ride", "needs_accessible"}
ANSWERED = NEEDS_HELP | {"leaving"}
ESTIMATED = {"unknown", "unreachable"}


@dataclass(frozen=True)
class NeedConfig:
    # Three nearby answered calls weigh as much as the prior. Small enough that a cluster of answers
    # moves an estimate, large enough that one answer next door doesn't swing it past 0.5 alone.
    prior_strength: float = 3.0
    # Gaussian kernel width. A census block group in Altadena is roughly 400-600 m across, so 250 m
    # keeps smoothing inside about one block group.
    kernel_meters: float = 250.0
    # A neighbor saying "she can't get out" multiplies the odds by 8: if nominations are right about
    # 70% of the time and the base rate is about 22%, the posterior is about 0.7.
    nomination_lr: float = 8.0
    # Said they can leave on their own. Not zero: plans change and the hazard never marks anyone safe.
    leaving_probability: float = 0.03
    floor: float = 0.01
    ceiling: float = 0.99


def _odds_update(p: float, likelihood_ratio: float) -> float:
    odds = p / (1 - p) * likelihood_ratio
    return odds / (1 + odds)


def estimate(households: list[dict], nominated: set[str], smoothing: bool, config: NeedConfig = NeedConfig()) -> dict[str, float]:
    """needProbability for every household we estimate (outcome unknown or unreachable)."""
    located = [h for h in households if h.get("lat") is not None]
    answered = [h for h in located if h["outcome"] in ANSWERED]
    answered_xy = np.array([to_xy(h["lat"], h["lng"]) for h in answered]) if answered else np.zeros((0, 2))
    answered_y = np.array([1.0 if h["outcome"] in NEEDS_HELP else 0.0 for h in answered])
    result: dict[str, float] = {}
    for household in households:
        if household["outcome"] not in ESTIMATED:
            continue
        p = float(household["needPrior"])
        if smoothing and household.get("lat") is not None and len(answered):
            x, y = to_xy(household["lat"], household["lng"])
            d2 = (answered_xy[:, 0] - x) ** 2 + (answered_xy[:, 1] - y) ** 2
            w = np.exp(-d2 / (2 * config.kernel_meters**2))
            w[d2 > (3 * config.kernel_meters) ** 2] = 0.0
            p = (p * config.prior_strength + float(w @ answered_y)) / (config.prior_strength + float(w.sum()))
        if household["_id"] in nominated:
            p = _odds_update(min(max(p, config.floor), config.ceiling), config.nomination_lr)
        result[household["_id"]] = min(max(p, config.floor), config.ceiling)
    return result


def known_probability(outcome: str, config: NeedConfig = NeedConfig()) -> float | None:
    if outcome in NEEDS_HELP:
        return 1.0
    if outcome == "leaving":
        return config.leaving_probability
    return None
