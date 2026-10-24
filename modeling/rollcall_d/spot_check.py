"""The human spot check of the implied-reassurance grader.

Two people label each sampled line on their own (`human_a`, `human_b`: yes if it implies help is coming,
no if not). We report how often each agrees with the model grader, how often they agree with each other,
and Cohen's kappa for both, so "the grader found N" doesn't rest on the grader alone.

Labels are keyed by (status, text) and survive re-runs: re-grading rewrites the sample but carries every
existing label over, and keeps labeled lines that dropped out of the new sample.
"""

import csv
from pathlib import Path

COLUMNS = ["id", "source", "status", "text", "lexical", "model", "model_reason", "human_a", "human_b"]
LABELERS = ("human_a", "human_b")


def _label(value: str | None) -> str | None:
    value = (value or "").strip().lower()
    return value if value in ("yes", "no") else None


def load(path: Path) -> dict[tuple[str, str], dict]:
    """Existing rows by (status, text). A legacy single `human` column counts as `human_a`."""
    if not path.exists():
        return {}
    rows = {}
    for row in csv.DictReader(path.open()):
        row = dict(row)
        if "human_a" not in row and "human" in row:
            row["human_a"] = row.pop("human")
        rows[(row["status"], row["text"])] = row
    return rows


def write(path: Path, sample: list[dict], previous: dict[tuple[str, str], dict]) -> None:
    rows, seen = [], set()
    for r in sample:
        key = (r["status"], r["text"])
        seen.add(key)
        model = r["model"] or {}
        verdict = "" if model.get("impliesHelpComing") is None else ("yes" if model["impliesHelpComing"] else "no")
        old = previous.get(key, {})
        rows.append({"id": r["id"], "source": r["source"], "status": r["status"], "text": r["text"],
                     "lexical": "yes" if r["lexical"] else "no", "model": verdict, "model_reason": model.get("reason", ""),
                     "human_a": old.get("human_a", ""), "human_b": old.get("human_b", "")})
    for key, old in previous.items():  # never drop a label someone already gave
        if key not in seen and any(_label(old.get(c)) for c in LABELERS):
            rows.append({c: old.get(c, "") for c in COLUMNS})
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def cohen_kappa(a: list[str], b: list[str]) -> float | None:
    """Agreement beyond chance for two yes/no raters. None when it's undefined (both always say the same)."""
    n = len(a)
    if n == 0:
        return None
    observed = sum(x == y for x, y in zip(a, b)) / n
    pa, pb = a.count("yes") / n, b.count("yes") / n
    expected = pa * pb + (1 - pa) * (1 - pb)
    return None if expected == 1 else round((observed - expected) / (1 - expected), 3)


def _pair(rows: list[dict], first: str, second: str) -> dict | None:
    pairs = [(_label(r.get(first)), _label(r.get(second))) for r in rows]
    pairs = [(x, y) for x, y in pairs if x and y]
    if not pairs:
        return None
    a, b = [x for x, _ in pairs], [y for _, y in pairs]
    return {"labeled": len(pairs), "agreement": round(sum(x == y for x, y in pairs) / len(pairs), 3), "kappa": cohen_kappa(a, b)}


def agreement(path: Path) -> dict | None:
    rows = list(load(path).values())
    report = {
        "graderVsHumanA": _pair(rows, "model", "human_a"),
        "graderVsHumanB": _pair(rows, "model", "human_b"),
        "humanAVsHumanB": _pair(rows, "human_a", "human_b"),
    }
    disagreements = [r["text"] for r in rows if _label(r.get("model")) and any(_label(r.get(c)) and _label(r.get(c)) != _label(r["model"]) for c in LABELERS)]
    if not any(report.values()):
        return None
    report["graderFalsePositives"] = [r["text"] for r in rows if _label(r.get("model")) == "yes" and all(_label(r.get(c)) == "no" for c in LABELERS)]
    report["disagreements"] = disagreements[:10]
    return report
