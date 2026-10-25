import { readFile } from "node:fs/promises";
import path from "node:path";

// The hazard files under data/hazard. A missing file answers null so the map simply leaves the layer off.
export async function hazardFileResponse(name: string) {
  try {
    const text = await readFile(path.join(process.cwd(), "data", "hazard", name), "utf8");
    return new Response(text, { headers: { "content-type": "application/geo+json" } });
  } catch {
    return Response.json(null);
  }
}
