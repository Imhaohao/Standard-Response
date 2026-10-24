"""Run the persona eval and write data/eval-results.json (summary) and data/eval-transcripts.jsonl.

  uv run python scripts/eval_personas.py                               # scripted stand-in agent, in process
  uv run python scripts/eval_personas.py --endpoint http://localhost:8787  # Track B's real POST /turn
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.evaluation import HttpAgent, run_all, summarize  # noqa: E402
from rollcall_d.paths import DATA  # noqa: E402
from rollcall_d.scripted_agent import ScriptedAgent  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--endpoint", help="Track B's text agent base URL; omit to use the scripted stand-in")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=str(DATA / "eval-results.json"))
    args = parser.parse_args()

    cards = json.loads((DATA / "personas.json").read_text())
    if args.limit:
        cards = cards[: args.limit]
    if args.endpoint:
        agent, label, concurrency = HttpAgent(args.endpoint), f"Track B text agent at {args.endpoint}", args.concurrency
    else:
        agent, label, concurrency = ScriptedAgent(), "Scripted stand-in agent (keyword rules, no Claude). A floor, not our result.", 1
    runs = run_all(agent, cards, concurrency, args.seed)
    summary = summarize(runs, label)
    if not args.endpoint:
        summary["caveat"] = ("The scripted stand-in was written against the simulated residents' phrasing, so its score only shows the "
                             "harness works end to end. Report the run against Track B's endpoint, never this one.")
    Path(args.out).write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    with (DATA / "eval-transcripts.jsonl").open("w") as handle:
        for run in runs:
            handle.write(json.dumps({"persona": run.card["id"], "language": run.card["language"], "traits": run.card.get("traits", []),
                                     "record": run.record, "transcript": run.transcript}, ensure_ascii=False) + "\n")
    fields = {k: v["accuracy"] for k, v in summary["fields"].items()}
    print(f"{summary['completed']}/{summary['personas']} completed; fields {fields}; corrections {summary['corrections']['accuracy']}")


if __name__ == "__main__":
    main()
