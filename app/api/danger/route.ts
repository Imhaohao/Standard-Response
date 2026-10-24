import { connection } from "next/server";
import { hazardFileResponse } from "@/lib/hazard-file";

// Track D's ensemble danger zones under live NWS wind (modeling/scripts/danger_zones.py).
export async function GET() {
  await connection();
  return hazardFileResponse("danger-zones.geojson");
}
