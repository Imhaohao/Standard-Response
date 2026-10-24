"""Write data/personas.json: about 200 persona cards with truth and corrections.

The first cards are the sample riders (Carmen and Walter use the demo script). The rest are drawn from
data/population.json when it exists, so the eval's residents look like the synthetic population; until
then from a simple age-conditioned sampler (stated below). Addresses are real OSM points in west Altadena.
"""

import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rollcall_d.paths import DATA, OSM  # noqa: E402

SEED = 26
TOTAL = 200
WEST_ALTADENA = {"south": 34.180, "north": 34.206, "west": -118.172, "east": -118.134}

FIRST_EN = ["Ruth", "Harold", "Lucille", "Clarence", "Beatrice", "Raymond", "Gloria", "Leon", "Shirley", "Earl", "Pearl",
            "Vernon", "Hattie", "Samuel", "Odessa", "Walter", "Mae", "Darnell", "Mei-Ling", "Wen", "Kwame", "Hyun-woo",
            "Bernice", "Marjorie", "Eugene", "Lorraine", "Otis", "Irene", "Chester", "Frances"]
FIRST_ES = ["Josefina", "Tomás", "Rosario", "Esperanza", "Arturo", "Yolanda", "Felipe", "Rogelio", "Alma", "Gustavo",
            "Juanita", "Dolores", "Ignacio", "Consuelo", "Guadalupe", "Refugio", "Socorro", "Ramón", "Leticia", "Héctor"]
LAST_EN = ["Haynes", "Cole", "Kim", "Odum", "Chen", "Washington", "Takahashi", "Mensah", "Park", "Jefferson", "Price",
           "Holloway", "Banks", "Pruitt", "Whitfield", "Goldberg", "Liu", "Fontaine", "Zhou", "Simmons", "Brooks", "Tate"]
LAST_ES = ["Reyes", "Méndez", "Flores", "Gutiérrez", "Navarro", "Salazar", "Ramírez", "Castillo", "Herrera", "Delgado",
           "Aguilar", "Morales", "Villanueva", "Vega", "Ortiz", "Cervantes", "Ibarra", "Lozano"]

# Share of cards with each trait. Spanish is set by language (about 35%, Altadena's Latino share is ~27%,
# higher among our riders); corrections are on ~45% because they're what we most need to measure.
TRAIT_RATES = {"hard_of_hearing": 0.15, "partial_address": 0.15, "panic": 0.10, "tangents": 0.15, "second_voice": 0.10,
               "asks_reassurance": 0.18, "flames": 0.03, "medical": 0.03, "nominates_neighbor": 0.20}
SPANISH_RATE = 0.35
CORRECTION_RATE = 0.45
INBOUND_RATE = 0.4
# Cards drawn from the population over-sample households that need help (70%), because those are the
# calls whose fields matter most. The rest are drawn from households that can leave on their own.
NEEDS_HELP_SHARE = 0.7


def west_altadena_addresses() -> list[dict]:
    rows = json.loads((OSM / "addresses.json").read_text())
    box = WEST_ALTADENA
    return [r for r in rows if r["housenumber"].isdigit() and box["south"] < r["lat"] < box["north"] and box["west"] < r["lng"] < box["east"]]


def label(row: dict) -> str:
    return f"{row['housenumber']} {row['street']}, Altadena"


# ---- truth --------------------------------------------------------------------------------------

def sample_truth(rng: random.Random, age: int) -> dict:
    """Age-conditioned stand-in until data/population.json exists. Rates are rough, stated assumptions:
    mobility aids rise steeply after 75; about 10% of those 70+ use home oxygen among frail riders."""
    roll = rng.random()
    if age >= 80:
        mobility = "bedbound" if roll < 0.08 else "manual_wheelchair" if roll < 0.25 else "power_wheelchair" if roll < 0.33 else "walker" if roll < 0.65 else "walks"
    elif age >= 70:
        mobility = "bedbound" if roll < 0.04 else "manual_wheelchair" if roll < 0.16 else "power_wheelchair" if roll < 0.22 else "walker" if roll < 0.5 else "walks"
    else:
        mobility = "manual_wheelchair" if roll < 0.08 else "power_wheelchair" if roll < 0.12 else "walker" if roll < 0.25 else "walks"
    return truth_from(rng, age, mobility)


def truth_from(rng: random.Random, age: int, mobility: str, people: int | None = None, has_car: bool | None = None) -> dict:
    if mobility == "bedbound":
        assistance = "two_person_lift"
    elif mobility == "walks":
        assistance = "none"
    else:
        assistance = rng.choices(["none", "one_person_assist", "two_person_lift"], [0.5, 0.4, 0.1])[0]
    oxygen = age >= 70 and rng.random() < 0.10
    has_car = rng.random() < (0.35 if mobility != "walks" else 0.7) if has_car is None else has_car
    limited = mobility != "walks" or oxygen
    can_leave = rng.choice(["no", "no", "unsure"]) if limited else ("yes" if has_car else rng.choice(["no", "unsure"]))
    people = people if people is not None else (1 if age >= 75 and rng.random() < 0.55 else rng.choice([1, 2, 2, 3, 4]))
    return {"canLeave": can_leave, "peopleCount": people, "mobility": mobility, "assistanceRequired": assistance,
            "medical": ["oxygen"] if oxygen else [], "pets": rng.random() < 0.35, "hasCar": has_car}


def population_truths() -> tuple[list[dict], list[dict]] | None:
    """Population households split into (need help, can leave on their own), or None before it exists."""
    path = DATA / "population.json"
    if not path.exists():
        return None
    needy, able = [], []
    for household in json.loads(path.read_text()):
        limited = household["canLeave"] != "yes" or household["mobility"] != "walks" or household["medical"]
        (needy if limited else able).append(household)
    return needy, able


# ---- corrections --------------------------------------------------------------------------------

WRONG_FIRST = {
    "peopleCount": lambda t, rng: max(1, t["peopleCount"] - 1) if t["peopleCount"] > 1 else 2,
    "mobility": lambda t, rng: "walks" if t["mobility"] != "walks" else "walker",
    "assistanceRequired": lambda t, rng: "none" if t["assistanceRequired"] != "none" else "one_person_assist",
    "canLeave": lambda t, rng: "yes" if t["canLeave"] != "yes" else "no",
    "medical": lambda t, rng: [] if t["medical"] else ["oxygen"],
}


def make_correction(rng: random.Random, truth: dict, traits: list[str]) -> dict:
    field = rng.choice(list(WRONG_FIRST))
    when = "second_voice" if "second_voice" in traits else rng.choice(["next_turn", "readback"])
    return {"field": field, "firstSays": json.dumps(WRONG_FIRST[field](truth, rng)), "when": when}


# ---- the human-readable card --------------------------------------------------------------------

MOBILITY_WORDS = {"walks": "can walk", "walker": "uses a walker", "manual_wheelchair": "uses a wheelchair",
                  "power_wheelchair": "uses a power wheelchair", "bedbound": "is bedbound"}
ASSIST_WORDS = {"none": "", "one_person_assist": " and needs one person to help getting out",
                "two_person_lift": " and needs two people to lift"}


def card_text(card: dict) -> str:
    t = card["truth"]
    who = "You live alone" if t["peopleCount"] == 1 else f"There are {t['peopleCount']} of you at home"
    lang = " You speak Spanish." if card["language"] == "es" else ""
    need = f"The person who needs the most help {MOBILITY_WORDS[t['mobility']]}{ASSIST_WORDS[t['assistanceRequired']]}."
    extras = []
    if t["medical"]:
        extras.append("You use oxygen.")
    extras.append("You have a car you can use." if t["hasCar"] else "You have no car.")
    if t["pets"]:
        extras.append("You have a dog.")
    if "correction" in card:
        c = card["correction"]
        extras.append(f"At first you get {c['field']} wrong (you say {c['firstSays']}), then correct it" +
                      (" when someone else in the room reminds you." if c["when"] == "second_voice" else "."))
    style = [s.replace("_", " ") for s in card["traits"]]
    if style:
        extras.append("How you talk: " + ", ".join(style) + ".")
    return f"{card['name']}, {card['age']}, {card['address']}.{lang} {who}. {need} " + " ".join(extras)


# ---- cards --------------------------------------------------------------------------------------

def demo_cards(riders: list[dict]) -> list[dict]:
    by_id = {r["rider_id"]: r for r in riders}
    carmen, walter = by_id["R-1001"], by_id["R-1002"]
    cards = [
        {"id": "P-001", "name": carmen["name"], "age": 79, "language": "es", "direction": "outbound", "riderId": "R-1001",
         "address": carmen["address"], "lat": float(carmen["lat"]), "lng": float(carmen["lng"]),
         "onFile": {"mobility": carmen["mobility"], "assistanceRequired": carmen["assistance"]},
         "truth": {"canLeave": "no", "peopleCount": 2, "mobility": "manual_wheelchair", "assistanceRequired": "two_person_lift",
                   "medical": [], "pets": False, "hasCar": False},
         "correction": {"field": "peopleCount", "firstSays": "1", "when": "next_turn"},
         "traits": ["asks_reassurance"],
         "card": ("Carmen, 79, speaks Spanish. You first say it's just you. Then you remember your son is home: "
                  "he uses a wheelchair and needs two people to lift him. Ask whether someone is coming.")},
        {"id": "P-002", "name": walter["name"], "age": 84, "language": "en", "direction": "outbound", "riderId": "R-1002",
         "address": walter["address"], "lat": float(walter["lat"]), "lng": float(walter["lng"]),
         "onFile": {"mobility": walter["mobility"], "assistanceRequired": walter["assistance"]},
         "truth": {"canLeave": "no", "peopleCount": 1, "mobility": "manual_wheelchair", "assistanceRequired": "one_person_assist",
                   "medical": ["oxygen"], "pets": True, "hasCar": False},
         "traits": ["hard_of_hearing"],
         "card": ("Walter, 84. You live alone with your dog and use a wheelchair; you need one person to help you out. "
                  "You use oxygen. You're a little hard of hearing, so ask the agent to repeat once.")},
    ]
    return cards


def rider_card(rng: random.Random, rider: dict, index: int) -> dict:
    age = rng.randint(66, 94)
    mobility = rider["mobility"] or sample_truth(rng, age)["mobility"]
    truth = truth_from(rng, age, mobility)
    if rider["assistance"]:
        truth["assistanceRequired"] = rider["assistance"]
    on_file = {k: v for k, v in (("mobility", rider["mobility"]), ("assistanceRequired", rider["assistance"])) if v}
    return {"id": f"P-{index:03d}", "name": rider["name"], "age": age, "language": rider["language"], "direction": "outbound",
            "riderId": rider["rider_id"], "address": rider["address"], "lat": float(rider["lat"]), "lng": float(rider["lng"]),
            "onFile": on_file, "truth": truth}


def drawn_card(rng: random.Random, index: int, point: dict, population: tuple[list[dict], list[dict]] | None) -> dict:
    spanish = rng.random() < SPANISH_RATE
    first = rng.choice(FIRST_ES if spanish else FIRST_EN)
    last = rng.choice(LAST_ES if spanish else LAST_EN)
    if population:
        needy, able = population
        person = rng.choice(needy if rng.random() < NEEDS_HELP_SHARE else able)
        age = person["age"]
        truth = truth_from(rng, age, person["mobility"], person["peopleCount"], person["hasCar"])
        truth["assistanceRequired"] = person["assistanceRequired"]
        truth["medical"] = person["medical"]
        truth["canLeave"] = person["canLeave"]
    else:
        age = rng.randint(60, 95)
        truth = sample_truth(rng, age)
    inbound = rng.random() < INBOUND_RATE
    return {"id": f"P-{index:03d}", "name": f"{first} {last}", "age": age, "language": "es" if spanish else "en",
            "direction": "inbound" if inbound else "outbound", "riderId": None, "address": label(point),
            "lat": point["lat"], "lng": point["lng"], "onFile": {}, "truth": truth}


def add_traits(rng: random.Random, card: dict, neighbors: list[dict]) -> None:
    traits = [t for t, rate in TRAIT_RATES.items() if rng.random() < rate]
    if "partial_address" in traits and card["direction"] == "outbound":
        traits.remove("partial_address")  # their address is on file; partial addresses are an inbound problem
    if "flames" in traits and "medical" in traits:
        traits.remove("medical")
    card["traits"] = traits
    if rng.random() < CORRECTION_RATE or "second_voice" in traits:
        card["correction"] = make_correction(rng, card["truth"], traits)
    if "nominates_neighbor" in traits:
        card["neighborAddress"] = label(rng.choice(neighbors))


def main() -> None:
    rng = random.Random(SEED)
    with (DATA / "sample-riders.csv").open() as handle:
        riders = list(csv.DictReader(handle))
    addresses = west_altadena_addresses()
    population = population_truths()
    cards = demo_cards(riders)
    for rider in riders[2:]:
        card = rider_card(rng, rider, len(cards) + 1)
        add_traits(rng, card, addresses)
        cards.append(card)
    taken = {c["address"] for c in cards}
    pool = [a for a in rng.sample(addresses, len(addresses)) if label(a) not in taken]
    while len(cards) < TOTAL:
        card = drawn_card(rng, len(cards) + 1, pool.pop(), population)
        add_traits(rng, card, addresses)
        cards.append(card)
    for card in cards:
        card.setdefault("card", card_text(card))
    out = DATA / "personas.json"
    out.write_text(json.dumps(cards, indent=1, ensure_ascii=False))
    corrections = sum("correction" in c for c in cards)
    spanish = sum(c["language"] == "es" for c in cards)
    print(f"wrote {out}: {len(cards)} cards, {corrections} with corrections, {spanish} in Spanish, truth from {'population' if population else 'sampler'}")


if __name__ == "__main__":
    main()
