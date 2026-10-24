import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

// The flow lab's inputs: Track D's synthetic households (only the fields the crowd model reads)
// and the mesh add-on's simulation results. Fictional households only.
type Household = { lat: number; lng: number; peopleCount: number; canLeave: string; hasCar: boolean };

async function readJson(file: string) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", file), "utf8"));
  } catch {
    return null;
  }
}

export async function GET() {
  await connection();
  const [population, results] = await Promise.all([readJson("population.json"), readJson("flow-results.json")]);
  const households = ((population ?? []) as Household[]).map(({ lat, lng, peopleCount, canLeave, hasCar }) => ({ lat, lng, peopleCount, canLeave, hasCar }));
  return Response.json({ households, results: results && { ...results, runs: undefined } });
}
