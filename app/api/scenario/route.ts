import { connection } from "next/server";
import { hazardFileResponse } from "@/lib/hazard-file";

// Track D's hazard scenario (nested fire fronts). The maps draw it; Track D owns the file.
export async function GET() {
  await connection();
  return hazardFileResponse("scenario.geojson");
}
