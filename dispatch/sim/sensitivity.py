"""Sensitivity panel: fleet size, answer rate and hazard speed, each against the base case."""

from __future__ import annotations

from .aggregate import comparison, policy_block, summarize
from .constants import Config

FACTORS = [
    ("fleetSize", "Fleet size (vehicles)", "fleet_size", [4, 6, 8, 12]),
    ("answerRate", "Answer rate (scale on each household's answer probability)", "answer_scale", [0.3, 0.6, 1.0]),
    ("hazardSpeed", "Hazard speed (fire arrival times multiplied by this; smaller is faster)", "hazard_scale", [0.35, 0.5, 0.7, 1.0]),
    ("call911Lead", "How early 911 callers phone (scale on the 20 min median lead before the fire arrives)", "lead_911_scale", [0.5, 1.0, 2.0, 3.0]),
]
SENSITIVITY_POLICIES = ["heuristic_outreach", "ortools_outreach", "alns_outreach", "today_911"]


def sensitivity_tasks(base: Config, seeds: list[int]) -> list[tuple[str, float, int, Config]]:
    tasks = []
    for key, _, field_name, levels in FACTORS:
        for level in levels:
            config = base.with_changes(**{field_name: level})
            tasks.extend((key, level, seed, config) for seed in seeds)
    return tasks


def level_entry(key: str, label: str, level: float, runs: list[dict]) -> dict:
    heuristic = [r["heuristic_outreach"] for r in runs]
    ortools = [r["ortools_outreach"] for r in runs]
    alns = [r["alns_outreach"] for r in runs]
    today = [r["today_911"] for r in runs]
    return {
        "factor": key,
        "factorLabel": label,
        "level": level,
        "seeds": len(runs),
        "dispatchOnly": {
            "pickupsOnTimeDifference": comparison(heuristic, ortools, "heuristic", "ortools")["difference"]["pickupsOnTime"],
            "heuristic": policy_block(heuristic)["pickupsOnTime"],
            "ortools": policy_block(ortools)["pickupsOnTime"],
            "ortoolsRidersNeverPickedUp": summarize([r["ridersNeverPickedUp"] for r in ortools]),
        },
        "dispatchOnlyAlns": {
            "pickupsOnTimeDifference": comparison(heuristic, alns, "heuristic", "alns")["difference"]["pickupsOnTime"],
            "heuristic": policy_block(heuristic)["pickupsOnTime"],
            "alns": policy_block(alns)["pickupsOnTime"],
            "alnsRidersNeverPickedUp": summarize([r["ridersNeverPickedUp"] for r in alns]),
        },
        "combined": {
            "pickupsOnTimeDifference": comparison(today, alns, "today", "ours")["difference"]["pickupsOnTime"],
            "today": policy_block(today)["pickupsOnTime"],
            "ours": policy_block(alns)["pickupsOnTime"],
            "todayRidersNeverPickedUp": summarize([r["ridersNeverPickedUp"] for r in today]),
            "oursRidersNeverPickedUp": summarize([r["ridersNeverPickedUp"] for r in alns]),
        },
        "needers": summarize([r["needers"] for r in alns]),
    }


def build_sensitivity(results_by_key: dict) -> list[dict]:
    entries = []
    for key, label, _, levels in FACTORS:
        for level in levels:
            runs = results_by_key.get((key, level), [])
            if runs:
                entries.append(level_entry(key, label, level, runs))
    return entries


def describe(entries: list[dict]) -> str:
    return ", ".join(f"{e['factor']}={e['level']}" for e in entries) or "none of the settings tried"


def dont_help_line(entries: list[dict]) -> str:
    gaps = [(e, e["dispatchOnlyAlns"]["pickupsOnTimeDifference"]) for e in entries]
    behind = [e for e, g in gaps if g["p95"] < 0]
    unclear = [e for e, g in gaps if g["p5"] <= 0 <= g["p95"]]
    smallest = min((e for e in entries if e["factor"] == "fleetSize"), key=lambda e: e["level"])
    unreached = smallest["combined"]["oursRidersNeverPickedUp"]
    return (
        f"With {int(smallest['level'])} vehicles our full process still leaves a median {unreached['median']:.0f} of "
        f"{smallest['needers']['median']:.0f} riders unpicked (5th to 95th percentile {unreached['p5']:.0f} to {unreached['p95']:.0f}); "
        f"a dispatcher cannot send vans that do not exist. Dispatch only, the ALNS optimizer finished fewer on-time pickups than "
        f"the heuristic at: {describe(behind)}. It showed no clear difference at: {describe(unclear)}."
    )
