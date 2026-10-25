"""Track D's live models: hazard deadlines and closures, need estimates, door-check order, address matching.

  uv run python scripts/run_models.py                # every 5 s against CONVEX_URL / .env.local
  uv run python scripts/run_models.py --once         # one pass, then exit
  uv run python scripts/run_models.py --time-scale 10  # a 4-hour night in 24 minutes

On start it turns off the "Need model" stand-in (Track D's own switch) so the two don't fight over
needProbability. Pass --keep-stand-in to leave it on. Once the last pass is 15 s old (the runner stopped,
or a --once pass ended), the stand-in covers again on its own, so the incident always has a need model.
"""

import argparse
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.convex_io import Convex  # noqa: E402
from rollcall_d.hazard import Scenario  # noqa: E402
from rollcall_d.runner import ModelRunner, RunnerConfig  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=float, default=5.0, help="seconds between passes; keep under 15, or the stand-in takes over between passes")
    parser.add_argument("--time-scale", type=float, default=1.0)
    parser.add_argument("--margin", type=float, default=150.0, help="closure safety margin in meters")
    parser.add_argument("--no-closures", action="store_true", help="don't add hazard closures")
    parser.add_argument("--keep-stand-in", action="store_true")
    parser.add_argument("--scenario", type=Path,
                        help="pin these hazard fronts, e.g. data/hazard/scenario-spread.geojson from the spread model; "
                             "by default the runner uses the scenario for the hazard picked on the call floor")
    args = parser.parse_args()

    convex = Convex()
    config = RunnerConfig(time_scale=args.time_scale, closure_margin_meters=args.margin, closures=not args.no_closures)
    runner = ModelRunner(convex, config, scenario=Scenario.load(args.scenario) if args.scenario else None)
    print(f"Track D models on {convex.url}, scenario: {args.scenario or 'the hazard picked on the call floor'}")
    if not args.keep_stand_in:
        convex.mutation("control:setStandIns", {"simulateNeedModel": False})
        print("Need-model stand-in switched off")
    while True:
        try:
            result = runner.run_pass()
            print(time.strftime("%H:%M:%S"), result.stats, f"alpha={result.door_alpha}")
        except Exception:  # keep running through a transient Convex or network error
            traceback.print_exc()
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
