"""Download the Eaton sheet of the UL FSRI Southern California Fires Timeline Dataset.

The dataset (doi:10.60752/102376.29905157) is a public Google Sheet linked from fsri.org. This saves the
Eaton tab as data/eaton/fsri-timeline-eaton.csv, the input to scripts/eaton_replay.py.
"""

import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.paths import DATA  # noqa: E402

SHEET = "1Xna6okyL59bk3m6oHphZrN-RWWxOtnBIL0R5EpaZ__4"
EATON_TAB = "1341829632"
URL = f"https://docs.google.com/spreadsheets/d/{SHEET}/gviz/tq?tqx=out:csv&gid={EATON_TAB}"


def main():
    target = DATA / "eaton" / "fsri-timeline-eaton.csv"
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(URL, timeout=60) as response:
        target.write_bytes(response.read())
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
