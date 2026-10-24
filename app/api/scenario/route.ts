import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

// Track D's hazard scenario (nested fire fronts). The maps draw it; Track D owns the file.
export async function GET() {
  await connection();
  try {
    const text = await readFile(path.join(process.cwd(), "data", "hazard", "scenario.geojson"), "utf8");
    return new Response(text, { headers: { "content-type": "application/geo+json" } });
  } catch {
    return Response.json(null);
  }
}
