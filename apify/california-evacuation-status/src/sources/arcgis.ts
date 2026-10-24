import { fetchJson } from "../http.js";
import type { Geometry } from "../types.js";

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

export interface ArcgisFeature {
  properties: Record<string, unknown> | null;
  geometry: Geometry | null;
}

interface FeatureCollection {
  features?: ArcgisFeature[];
  error?: { message?: string };
}

const queryUrl = (layerUrl: string, offset: number) => {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    outSR: "4326",
    f: "geojson",
    resultOffset: String(offset),
    resultRecordCount: String(PAGE_SIZE),
    orderByFields: "OBJECTID",
  });
  return `${layerUrl}/query?${params}`;
};

// ArcGIS answers HTTP 200 with an error body for bad queries, so check the body too.
export async function queryAllFeatures(layerUrl: string, timeoutSecs: number): Promise<ArcgisFeature[]> {
  const all: ArcgisFeature[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await fetchJson<FeatureCollection>(queryUrl(layerUrl, page * PAGE_SIZE), timeoutSecs);
    if (body.error) throw new Error(`ArcGIS error: ${body.error.message ?? "unknown"}`);
    const features = body.features ?? [];
    all.push(...features);
    if (features.length < PAGE_SIZE) break;
  }
  return all;
}

export const str = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);
export const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

export const isPolygonal = (geometry: Geometry | null): geometry is Extract<Geometry, { type: "Polygon" | "MultiPolygon" }> =>
  geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
