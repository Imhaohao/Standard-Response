"""Grade agent lines for implied reassurance and write data/honesty-results.json and a spot-check CSV.

Sources (any that exist): data/honesty-transcripts.jsonl (the red-team run, `eval_personas.py --honesty`),
data/eval-transcripts.jsonl (the persona eval), and live call lines from Convex (`--convex`).

  uv run python scripts/grade_honesty.py               # lexical grader only if no Anthropic credentials
  uv run python scripts/grade_honesty.py --convex      # also grade agent lines from real calls

The model grader reads ANTHROPIC_API_KEY from the environment or the repo's .env.local, else the SDK's own lookup.
"""

import argparse
import csv
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.evaluation import wilson  # noqa: E402
from rollcall_d.honesty import GRADER_MODEL, ModelGrader, lines_from_convex, lines_from_transcripts, run, spot_check_sample  # noqa: E402
from rollcall_d.paths import DATA  # noqa: E402

SPOT_CHECK = DATA / "honesty-spot-check.csv"


def model_grader_or_none() -> ModelGrader | None:
    try:
        grader = ModelGrader()
        grader.client.models.retrieve(GRADER_MODEL)
        return grader
    except Exception as error:  # no credentials, or no network: fall back to the lexical grader
        print(f"Model grader unavailable ({type(error).__name__}: {str(error)[:120]}); lexical grader only")
        return None


def human_agreement() -> dict | None:
    """Once someone fills the `human` column (yes/no), compare it with the model grader."""
    if not SPOT_CHECK.exists():
        return None
    rows = [r for r in csv.DictReader(SPOT_CHECK.open()) if r.get("human", "").strip().lower() in ("yes", "no")]
    rows = [r for r in rows if r["model"] in ("yes", "no")]
    if not rows:
        return None
    agree = sum(r["human"].strip().lower() == r["model"] for r in rows)
    return {"labeled": len(rows), "agreement": round(agree / len(rows), 3)}


def rate(flags: list[bool]) -> dict:
    n, k = len(flags), sum(flags)
    return {"flagged": k, "graded": n, "rate": round(k / n, 4) if n else None, "ci95": wilson(k, n)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--convex", action="store_true", help="also grade agent lines from live calls in Convex")
    parser.add_argument("--no-model", action="store_true")
    parser.add_argument("--spot-check", type=int, default=50)
    args = parser.parse_args()

    agreement_before = human_agreement()
    lines = []
    for name, label in (("honesty-transcripts.jsonl", "red-team set"), ("eval-transcripts.jsonl", "persona eval")):
        if (DATA / name).exists():
            lines += lines_from_transcripts(DATA / name, label)
    if args.convex:
        from rollcall_d.convex_io import Convex

        lines += lines_from_convex(Convex().query("estimates:agentLines", {"limit": 2000}))
    grader = None if args.no_model else model_grader_or_none()
    results = run(lines, grader)

    by_source = {}
    for source in sorted({r["source"] for r in results}):
        group = [r for r in results if r["source"] == source]
        by_source[source] = {"lexical": rate([r["lexical"] for r in group]),
                             "model": rate([bool(r["model"]["impliesHelpComing"]) for r in group if r["model"]]) if grader else None}
    by_status = {}
    for status in sorted({r["status"] for r in results}):
        group = [r for r in results if r["status"] == status and r["model"]]
        by_status[status] = rate([bool(r["model"]["impliesHelpComing"]) for r in group]) if grader else None
    by_language = {}
    for language in ("en", "es"):
        group = [r for r in results if r["language"] == language]
        if group:
            by_language[language] = {"lineShare": round(len(group) / len(results), 3), "lexical": rate([r["lexical"] for r in group]),
                                     "model": rate([bool(r["model"]["impliesHelpComing"]) for r in group if r["model"]]) if grader else None}
    flagged = [r for r in results if (r["model"] or {}).get("impliesHelpComing") or (not grader and r["lexical"])]
    summary = {
        "label": "Implied-reassurance grading of the agent's free text while no driver has accepted. Status templates are removed first; template-level false promises are zero by construction.",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "grader": GRADER_MODEL if grader else "lexical only (no model credentials when this ran)",
        "linesGraded": len(results),
        "lexical": rate([r["lexical"] for r in results]),
        "model": rate([bool(r["model"]["impliesHelpComing"]) for r in results if r["model"]]) if grader else None,
        "bySource": by_source,
        "byStatus": by_status,
        "byLanguage": by_language,
        "humanSpotCheck": agreement_before,
        "flaggedExamples": [{k: r[k] for k in ("source", "status", "text")} | {"quote": (r["model"] or {}).get("quote", "")} for r in flagged[:20]],
    }
    (DATA / "honesty-results.json").write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    with SPOT_CHECK.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "source", "status", "text", "lexical", "model", "model_reason", "human"])
        for r in spot_check_sample(results, args.spot_check):
            model = r["model"] or {}
            verdict = "" if model.get("impliesHelpComing") is None else ("yes" if model["impliesHelpComing"] else "no")
            writer.writerow([r["id"], r["source"], r["status"], r["text"], "yes" if r["lexical"] else "no", verdict, model.get("reason", ""), ""])
    print(f"graded {len(results)} lines; lexical {summary['lexical']}; model {summary['model']}")


if __name__ == "__main__":
    main()
