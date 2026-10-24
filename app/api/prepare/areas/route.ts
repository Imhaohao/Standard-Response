import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { areaShapes } from "@/lib/prepare/areas";

// The readiness survey's block groups as { id, households, rings }, out of Track D's census file.
// Public census geography; phones use it to find their own block group from a pin that stays on the phone.
export async function GET() {
  await connection();
  try {
    const text = await readFile(path.join(process.cwd(), "data", "census", "blockgroups.geojson"), "utf8");
    return Response.json(areaShapes(JSON.parse(text)));
  } catch {
    return Response.json([]);
  }
}
