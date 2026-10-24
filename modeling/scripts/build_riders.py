"""Write data/sample-riders.csv: about 40 fictional paratransit riders at real west Altadena
address points from OpenStreetMap. Names, phones and needs are invented. Phone numbers sit in the
555-0100 to 555-0199 block reserved for fiction; swap in team phones before a live demo.

Carmen and Walter are fixed for the demo script. Everyone else is drawn with a fixed seed.
"""

import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.paths import DATA, OSM  # noqa: E402

SEED = 13
RIDER_COUNT = 40
# West Altadena: north of Woodbury Rd, west of Lake Ave.
WEST_ALTADENA = {"south": 34.180, "north": 34.206, "west": -118.172, "east": -118.134}

DEMO_RIDERS = [
    # Carmen speaks Spanish. Her own need is on file; the demo correction adds her son's wheelchair and lift.
    {"rider_id": "R-1001", "name": "Carmen Ortiz", "street": "West Mariposa Street", "near": (34.1932, -118.1590),
     "language": "es", "mobility": "walker", "assistance": "none"},
    {"rider_id": "R-1002", "name": "Walter Briggs", "street": "North Lincoln Avenue", "near": (34.1890, -118.1586),
     "language": "en", "mobility": "manual_wheelchair", "assistance": "one_person_assist"},
]

FIRST = [
    "Lucille", "Tomás", "Bernice", "Harold", "Rosario", "Clarence", "Mei-Ling", "Darnell", "Josefina", "Raymond",
    "Esperanza", "Kwame", "Hyun-woo", "Gloria", "Leon", "Shirley", "Arturo", "Yolanda", "Odessa", "Felipe",
    "Mae", "Rogelio", "Ruth", "Alma", "Gustavo", "Wen", "Beatrice", "Ming", "Juanita", "Earl",
    "Dolores", "Vernon", "Ana", "Hattie", "Ignacio", "Pearl", "Samuel", "Consuelo",
]
LAST = [
    "Haynes", "Reyes", "Cole", "Kim", "Méndez", "Odum", "Chen", "Washington", "Flores", "Takahashi",
    "Gutiérrez", "Mensah", "Park", "Jefferson", "Price", "Holloway", "Navarro", "Banks", "Pruitt", "Salazar",
    "Whitfield", "Ramírez", "Goldberg", "Castillo", "Herrera", "Liu", "Fontaine", "Zhou", "Delgado", "Simmons",
    "Aguilar", "Brooks", "Morales", "Tate", "Villanueva", "Greene", "Okafor", "Vega",
]
SPANISH_FIRST = {"Tomás", "Rosario", "Josefina", "Esperanza", "Arturo", "Yolanda", "Felipe", "Rogelio", "Alma",
                 "Gustavo", "Juanita", "Dolores", "Ana", "Ignacio", "Consuelo"}

# Paratransit riders lean on mobility aids. Blank means "not on file", which the import accepts.
NEEDS = [
    ("walker", "none", 9), ("walker", "one_person_assist", 4), ("manual_wheelchair", "none", 4),
    ("manual_wheelchair", "one_person_assist", 5), ("power_wheelchair", "none", 5), ("power_wheelchair", "one_person_assist", 2),
    ("bedbound", "two_person_lift", 3), ("walks", "none", 3), ("", "", 3),
]


def short_address(row: dict) -> str:
    return f"{row['housenumber']} {row['street']}, Altadena"


def in_west_altadena(row: dict) -> bool:
    box = WEST_ALTADENA
    return box["south"] < row["lat"] < box["north"] and box["west"] < row["lng"] < box["east"] and row["housenumber"].isdigit()


def nearest_on_street(addresses: list[dict], street: str, near: tuple[float, float]) -> dict:
    on_street = [a for a in addresses if a["street"] == street]
    return min(on_street, key=lambda a: (a["lat"] - near[0]) ** 2 + (a["lng"] - near[1]) ** 2)


def spread_sample(addresses: list[dict], count: int, rng: random.Random, taken: set[str]) -> list[dict]:
    """At most two riders per street, so the list covers the neighborhood."""
    per_street: dict[str, int] = {}
    chosen = []
    for row in rng.sample(addresses, len(addresses)):
        if row["osmId"] in taken or per_street.get(row["street"], 0) >= 2:
            continue
        per_street[row["street"]] = per_street.get(row["street"], 0) + 1
        chosen.append(row)
        if len(chosen) == count:
            break
    return chosen


def main() -> None:
    rng = random.Random(SEED)
    addresses = [a for a in json.loads((OSM / "addresses.json").read_text()) if in_west_altadena(a)]
    rows = []
    for demo in DEMO_RIDERS:
        point = nearest_on_street(addresses, demo["street"], demo["near"])
        rows.append({**{k: demo[k] for k in ("rider_id", "name", "language", "mobility", "assistance")}, "point": point})
    taken = {r["point"]["osmId"] for r in rows}
    needs = [(m, a) for m, a, n in NEEDS for _ in range(n)]
    rng.shuffle(needs)
    names = list(zip(FIRST, LAST))
    for i, point in enumerate(spread_sample(addresses, RIDER_COUNT - len(rows), rng, taken)):
        first, last = names[i]
        mobility, assistance = needs[i % len(needs)]
        language = "es" if first in SPANISH_FIRST and rng.random() < 0.8 else "en"
        rows.append({"rider_id": f"R-{1003 + i}", "name": f"{first} {last}", "language": language,
                     "mobility": mobility, "assistance": assistance, "point": point})
    out = DATA / "sample-riders.csv"
    with out.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["rider_id", "name", "address", "lat", "lng", "phone", "language", "mobility", "assistance"])
        for i, row in enumerate(rows):
            p = row["point"]
            writer.writerow([row["rider_id"], row["name"], short_address(p), p["lat"], p["lng"],
                             f"+1626555{101 + i:04d}", row["language"], row["mobility"], row["assistance"]])
    print(f"wrote {out} with {len(rows)} riders")


if __name__ == "__main__":
    main()
