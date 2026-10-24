import { isoOrNull, normalizeZoneStatus } from "../status.js";
import type { EvacuationRecord, SourceName } from "../types.js";
import { type ArcgisFeature, isPolygonal, num, queryAllFeatures, str } from "./arcgis.js";

// Cal OES statewide aggregation of county evacuation layers (ArcGIS Online item c0dd2a8779764c26910b83a7e974ee66).
const CAL_OES_LAYER = "https://services.arcgis.com/BLN4oKB0N1YSgvY8/arcgis/rest/services/CA_EVACUATIONS_CalOESHosted_view/FeatureServer/0";
// CAL FIRE statewide combined evacuation status, Genasys Protect (formerly Zonehaven) schema.
const CAL_FIRE_LAYER =
  "https://services5.arcgis.com/bz1uwWPKUInZBK94/arcgis/rest/services/California_Combined_Statewide_Evacuation_Public_View/FeatureServer/0";

const titleCase = (text: string) => text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());

function calOesRecord(feature: ArcgisFeature): EvacuationRecord | null {
  const p = feature.properties ?? {};
  const zoneId = str(p.ZONE_ID);
  if (!zoneId || !isPolygonal(feature.geometry)) return null;
  const county = str(p.COUNTY);
  return {
    source: "cal-oes",
    sourceUrl: CAL_OES_LAYER,
    kind: "evacuation_zone",
    id: zoneId,
    name: str(p.ZONE_NAME) ?? zoneId,
    county: county ? titleCase(county) : null,
    status: normalizeZoneStatus(str(p.STATUS)),
    updatedAt: isoOrNull(num(p.EDIT_DATE) ?? num(p.STATEWIDE_LAST_UPDATED) ?? num(p.EditDate)),
    geometry: feature.geometry,
    properties: {
      rawStatus: str(p.STATUS),
      eventType: str(p.EVENT_TYPE),
      notes: str(p.NOTES),
      criticalInfo: str(p.CRITICAL_INFO),
      publicInfo: str(p.PUBLIC_INFO),
      city: str(p.CITY),
    },
  };
}

function calFireZoneRecord(feature: ArcgisFeature): EvacuationRecord | null {
  const p = feature.properties ?? {};
  const zoneId = str(p.zone_id);
  if (!zoneId || !isPolygonal(feature.geometry)) return null;
  return {
    source: "cal-fire-zones",
    sourceUrl: CAL_FIRE_LAYER,
    kind: "evacuation_zone",
    id: zoneId,
    name: str(p.known_as) ?? zoneId,
    county: str(p.county_name),
    status: normalizeZoneStatus(str(p.zone_status)),
    updatedAt: isoOrNull(num(p.last_updated)),
    geometry: feature.geometry,
    properties: {
      rawStatus: str(p.zone_status),
      statusReason: str(p.zone_status_reason),
      approvalStatus: str(p.zone_approval_status),
      dataSource: str(p.data_source_name),
      estimatedPopulation: num(p.est_population),
      structureCount: num(p.structure_count),
      url: str(p.url),
    },
  };
}

const LAYERS: Record<"calOesZones" | "calFireZones", { url: string; convert: (feature: ArcgisFeature) => EvacuationRecord | null }> = {
  calOesZones: { url: CAL_OES_LAYER, convert: calOesRecord },
  calFireZones: { url: CAL_FIRE_LAYER, convert: calFireZoneRecord },
};

export async function fetchZones(source: Extract<SourceName, "calOesZones" | "calFireZones">, timeoutSecs: number) {
  const layer = LAYERS[source];
  const features = await queryAllFeatures(layer.url, timeoutSecs);
  return features.map(layer.convert).filter((record): record is EvacuationRecord => record !== null);
}
