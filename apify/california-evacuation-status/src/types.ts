export type Kind = "evacuation_zone" | "road_closure" | "incident";
export type Status = "order" | "warning" | "advisory" | "lifted" | "closed" | "open" | "unknown";

export type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "LineString"; coordinates: [number, number][] }
  | { type: "Polygon"; coordinates: [number, number][][] }
  | { type: "MultiPolygon"; coordinates: [number, number][][][] };

export interface EvacuationRecord {
  source: string;
  sourceUrl: string;
  kind: Kind;
  id: string;
  name: string;
  county: string | null;
  status: Status;
  updatedAt: string | null;
  stale?: boolean;
  drill?: true;
  geometry: Geometry;
  properties: Record<string, unknown>;
}

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type SourceName = "calOesZones" | "calFireZones" | "calFireIncidents" | "calFireWebIncidents" | "caltransClosures";

export const ALL_SOURCES: SourceName[] = ["calOesZones", "calFireZones", "calFireIncidents", "calFireWebIncidents", "caltransClosures"];

export interface ActorInput {
  sources: SourceName[];
  counties: string[];
  boundingBox?: BoundingBox;
  closureDetail: "full" | "all";
  staleAfterHours: number;
  webhookUrl?: string;
  closureWebhookUrl?: string;
  webhookSecret?: string;
  brightDataApiKey?: string;
  brightDataZone?: string;
  drill: boolean;
  drillPolygon?: [number, number][];
  drillZoneName: string;
  drillClosure?: [number, number][];
  drillClosureName: string;
  requestTimeoutSecs: number;
}

export interface SourceResult {
  source: SourceName;
  ok: boolean;
  records: EvacuationRecord[];
  // Parts of a source that could not be read this run, such as a Caltrans district ("caltrans-lcs|d7").
  unreadFeeds: string[];
  error?: string;
  skipped?: string;
}
