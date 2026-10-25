// Picks the recording's town from the synthetic census (data/population.json): a fixed-seed sample
// of homes inside the calling area, each given the nearest unused real OSM address, then seeded
// through censusSeed:insertHomes in batches small enough for one Convex transaction each.

import { readFileSync } from "node:fs";
import path from "node:path";
import { AREA } from "../../convex/model";

type CensusHousehold = {
  id: string;
  lat: number;
  lng: number;
  age: number;
  peopleCount: number;
  mobility: "walks" | "walker" | "manual_wheelchair" | "power_wheelchair" | "bedbound";
  assistanceRequired: "none" | "one_person_assist" | "two_person_lift";
  medical: ("oxygen" | "dialysis" | "other")[];
  hasCar: boolean;
  canLeave: "yes" | "no" | "unsure";
  answersPhone: number;
  language: string;
  blockGroup: string;
};

type OsmAddress = { housenumber: string; street: string; lat: number; lng: number };

export type SeedHome = {
  address: string;
  lat: number;
  lng: number;
  callbackNumber: string;
  language: string;
  needPrior: number;
  name: string;
  age: number;
  answersPhone: number;
  repliesToText: boolean;
  truth: {
    canLeave: CensusHousehold["canLeave"];
    peopleCount: number;
    mobility: CensusHousehold["mobility"];
    assistanceRequired: CensusHousehold["assistanceRequired"];
    medical: CensusHousehold["medical"];
    pets: boolean;
    hasCar: boolean;
  };
};

const FIRST_NAMES = [
  "Ruth", "Alma", "Gustavo", "Mei-Ling", "Harold", "Josefina", "Darnell", "Ana", "Lucille", "Tomás",
  "Wen", "Beatrice", "Raymond", "Esperanza", "Kwame", "Hyun-woo", "Gloria", "Leon", "Shirley", "Arturo",
  "Yolanda", "Clarence", "Rosario", "Ming", "Odessa", "Felipe", "Bernice", "Jian", "Mae", "Rogelio",
];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inArea = (p: { lat: number; lng: number }) => p.lat >= AREA.south && p.lat <= AREA.north && p.lng >= AREA.west && p.lng <= AREA.east;

// Share of each block group that can't leave alone: the census rate the need model starts from.
function blockGroupRates(population: CensusHousehold[]) {
  const totals = new Map<string, { all: number; need: number }>();
  for (const home of population) {
    const row = totals.get(home.blockGroup) ?? { all: 0, need: 0 };
    row.all += 1;
    if (home.canLeave !== "yes") row.need += 1;
    totals.set(home.blockGroup, row);
  }
  return new Map([...totals].map(([group, row]) => [group, row.need / row.all]));
}

// Nearest unused address, searched in a coarse grid so 10,000 lookups stay instant.
class AddressBook {
  private cells = new Map<string, OsmAddress[]>();
  private used = new Set<OsmAddress>();
  private static readonly CELL = 0.002;

  constructor(addresses: OsmAddress[]) {
    for (const address of addresses) {
      const key = this.key(address.lat, address.lng);
      this.cells.set(key, [...(this.cells.get(key) ?? []), address]);
    }
  }

  private key(lat: number, lng: number, dLat = 0, dLng = 0) {
    return `${Math.floor(lat / AddressBook.CELL) + dLat}:${Math.floor(lng / AddressBook.CELL) + dLng}`;
  }

  nearest(lat: number, lng: number) {
    for (let ring = 1; ring <= 4; ring++) {
      let best: OsmAddress | null = null;
      let bestDistance = Infinity;
      for (let dLat = -ring; dLat <= ring; dLat++) {
        for (let dLng = -ring; dLng <= ring; dLng++) {
          for (const address of this.cells.get(this.key(lat, lng, dLat, dLng)) ?? []) {
            if (this.used.has(address)) continue;
            const distance = (address.lat - lat) ** 2 + (address.lng - lng) ** 2;
            if (distance < bestDistance) [best, bestDistance] = [address, distance];
          }
        }
      }
      if (best) {
        this.used.add(best);
        return best;
      }
    }
    return null;
  }
}

const shortStreet = (street: string) => street.replace(/ Street$/, " St").replace(/ Avenue$/, " Ave").replace(/ Drive$/, " Dr").replace(/ Road$/, " Rd");

// Never dialed (no voice server is attached), and still kept to the fictional 555 exchange.
const fakeNumber = (i: number) => `+1${["626", "818", "323"][Math.floor(i / 10_000)]}555${String(i % 10_000).padStart(4, "0")}`;

function toSeedHome(home: CensusHousehold, address: OsmAddress, rate: number, random: () => number, index: number): SeedHome {
  return {
    address: `${address.housenumber} ${shortStreet(address.street)}`,
    lat: home.lat,
    lng: home.lng,
    callbackNumber: fakeNumber(index),
    language: home.language === "es" ? "es" : "en",
    needPrior: Math.min(0.95, Math.max(0.03, rate + (random() - 0.5) * 0.12)),
    name: FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)],
    age: home.age,
    answersPhone: home.answersPhone,
    repliesToText: random() < 0.45,
    truth: {
      canLeave: home.canLeave,
      peopleCount: home.peopleCount,
      mobility: home.mobility,
      assistanceRequired: home.assistanceRequired,
      medical: home.medical,
      pets: random() < 0.4,
      hasCar: home.hasCar,
    },
  };
}

// `count` homes from inside the calling area, the same ones on every run for the same count.
export function censusTown(root: string, count: number, seed = 13): SeedHome[] {
  const population = JSON.parse(readFileSync(path.join(root, "data", "population.json"), "utf8")) as CensusHousehold[];
  const addresses = JSON.parse(readFileSync(path.join(root, "data", "osm", "addresses.json"), "utf8")) as OsmAddress[];
  const rates = blockGroupRates(population);
  const random = mulberry32(seed);
  const inside = population.filter(inArea);
  const order = inside.map((home) => ({ home, key: random() })).sort((a, b) => a.key - b.key);
  const book = new AddressBook(addresses.filter((a) => a.housenumber && a.street));
  const homes: SeedHome[] = [];
  for (const { home } of order) {
    if (homes.length >= count) break;
    const address = book.nearest(home.lat, home.lng);
    if (address) homes.push(toSeedHome(home, address, rates.get(home.blockGroup) ?? 0.1, random, homes.length));
  }
  return homes;
}
