import { connection, NextRequest } from "next/server";
import { hazardOf, SCENARIO_FILES } from "@/convex/hazards";
import { hazardFileResponse } from "@/lib/hazard-file";

// The hazard scenario for ?hazard= (wildfire when absent), from data/hazard. The maps draw it.
export async function GET(request: NextRequest) {
  await connection();
  const hazard = hazardOf(request.nextUrl.searchParams.get("hazard") ?? undefined);
  return hazardFileResponse(SCENARIO_FILES[hazard]);
}
