"""Run the persona eval and write data/eval-results.json (summary) and data/eval-transcripts.jsonl.

  uv run python scripts/eval_personas.py                               # scripted stand-in agent, in process
  uv run python scripts/eval_personas.py --endpoint http://localhost:8787  # the voice server's real POST /turn
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from concurrent.futures import ThreadPoolExecutor  # noqa: E402

from rollcall_d.agent_lines import HAZARD, hazards_spoken, probe_hazard  # noqa: E402
from rollcall_d.evaluation import CardRun, HttpAgent, run_all, run_card, summarize  # noqa: E402
from rollcall_d.paths import DATA  # noqa: E402
from rollcall_d.scripted_agent import ScriptedAgent  # noqa: E402


def drop_other_hazards(runs: list[CardRun]) -> None:
    """The call floor's hazard can change mid-run. A call that spoke another hazard's safety line is an error, not a score:
    the cards, the resident and the status-line checks are all for HAZARD."""
    for run in runs:
        agent = [t["text"] for t in run.transcript if t["speaker"] == "agent"]
        if run.error is None and (other := hazards_spoken(agent, run.card["language"]) - {HAZARD}):
            run.error = f"agent spoke the {min(other)} safety line; these cards and checks are for {HAZARD}"


HONESTY_CALLERS = 25
HONESTY_STATUSES = ("received", "reassigning")


def run_honesty(agent, cards: list[dict], concurrency: int, seed: int, transcripts: Path) -> None:
    pushers = [c for c in cards if "asks_reassurance" in c.get("traits", [])][:HONESTY_CALLERS]
    jobs = [(card, status) for card in pushers for status in HONESTY_STATUSES]

    def one(job):
        return run_card(agent, job[0], seed, job[1])

    if concurrency > 1:
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            runs = list(pool.map(one, jobs))
    else:
        runs = [one(job) for job in jobs]
    drop_other_hazards(runs)
    with transcripts.open("w") as handle:
        for run, (_, status) in zip(runs, jobs):
            handle.write(json.dumps({"persona": f"{run.card['id']}@{status}", "language": run.card["language"],
                                     "transcript": run.transcript, "error": run.error}, ensure_ascii=False) + "\n")
    print(f"red-team set: {len(runs)} calls ({len(pushers)} callers x {len(HONESTY_STATUSES)} statuses), "
          f"guard blocked {sum(r.guard_blocked for r in runs)} acknowledgments")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--endpoint", help="The voice server's text agent base URL; omit to use the scripted stand-in")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out", default=str(DATA / "eval-results.json"))
    parser.add_argument("--transcripts", help="where the transcripts go; defaults to beside --out, as <name>-transcripts.jsonl "
                        "(data/honesty-transcripts.jsonl with --honesty), so a scratch run never overwrites the published ones")
    parser.add_argument("--honesty", action="store_true",
                        help="red-team set: 25 reassurance-seeking callers, each with the ride pinned at received and at reassigning")
    args = parser.parse_args()

    cards = json.loads((DATA / "personas.json").read_text())
    if args.limit:
        cards = cards[: args.limit]
    if args.endpoint:
        agent, label, concurrency = HttpAgent(args.endpoint), f"Text agent at {args.endpoint}", args.concurrency
        if (spoken := probe_hazard(agent)) != HAZARD:
            sys.exit(f"The agent speaks for {spoken or 'an unknown hazard'}, and these cards are for {HAZARD}. "
                     f"Set the call floor's hazard to {HAZARD}, or wait for whoever set it, then run again.")
    else:
        agent, label, concurrency = ScriptedAgent(), "Scripted stand-in agent (keyword rules, no Claude). A floor, not our result.", 1
    out = Path(args.out)
    if args.honesty:
        default = DATA / "honesty-transcripts.jsonl" if out == DATA / "eval-results.json" else out.with_name("honesty-transcripts.jsonl")
        run_honesty(agent, cards, concurrency, args.seed, Path(args.transcripts) if args.transcripts else default)
        return
    runs = run_all(agent, cards, concurrency, args.seed)
    drop_other_hazards(runs)
    summary = summarize(runs, label)
    if not args.endpoint:
        summary["caveat"] = ("The scripted stand-in was written against the simulated residents' phrasing, so its score only shows the "
                             "harness works end to end. Report the run against the voice server's endpoint, never this one.")
    out.write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    transcripts = Path(args.transcripts) if args.transcripts else out.with_name(out.stem.removesuffix("-results") + "-transcripts.jsonl")
    with transcripts.open("w") as handle:
        for run in runs:
            handle.write(json.dumps({"persona": run.card["id"], "language": run.card["language"], "traits": run.card.get("traits", []),
                                     "record": run.record, "transcript": run.transcript}, ensure_ascii=False) + "\n")
    fields = {k: v["accuracy"] for k, v in summary["fields"].items()}
    print(f"{summary['completed']}/{summary['personas']} completed; fields {fields}; corrections {summary['corrections']['accuracy']}")


if __name__ == "__main__":
    main()
