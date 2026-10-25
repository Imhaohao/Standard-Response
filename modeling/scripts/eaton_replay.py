"""Replay the documented requests for help west of Lake Avenue on the night of the Eaton Fire.

  uv run python scripts/fetch_eaton.py     # once: the FSRI timeline sheet
  uv run python scripts/eaton_replay.py    # writes data/eaton/replay-results.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.eaton_replay import write  # noqa: E402


def main():
    results = write()
    print(json.dumps({"cannotLeave": results["cannotLeave"], "firstFireWestOfLake": results["firstFireWestOfLake"]}, indent=2))
    fleet = results["fleetCheck"]
    for scenario in ("order325", "firstFireWestOfLake"):
        print(scenario, [(row["vans"], row["share"]) for row in fleet[scenario]["byFleetSize"]])


if __name__ == "__main__":
    main()
