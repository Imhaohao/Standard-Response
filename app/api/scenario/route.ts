import { connection, NextRequest } from "next/server";
import { hazardOf, SCENARIO_FILES } from "@/convex/hazards";
import { hazardFileResponse } from "@/lib/hazard-file";

// Track D's hazard scenario for ?hazard= (wildfire when absent). The maps draw it; Track D owns the files.
export async function GET(request: NextRequest) {
  await connection();
  const hazard = hazardOf(request.nextUrl.searchParams.get("hazard") ?? undefined);
  return hazardFileResponse(SCENARIO_FILES[hazard]);
}
