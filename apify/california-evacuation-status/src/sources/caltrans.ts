import { fetchJson } from "../http.js";
import type { EvacuationRecord, Geometry } from "../types.js";

const DISTRICTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const districtUrl = (district: number) => `https://cwwp2.dot.ca.gov/data/d${district}/lcs/lcsStatusD${String(district).padStart(2, "0")}.json`;

type Fields = Record<string, string | undefined>;

interface Closure {
  closureTimestamp?: { closureStartEpoch?: string; closureEndEpoch?: string; isClosureEndIndefinite?: string };
  facility?: string;
  typeOfClosure?: string;
  typeOfWork?: string;
  lanesClosed?: string;
  totalExistingLanes?: string;
}

interface Lcs {
  index?: string;
  recordTimestamp?: { recordEpoch?: string };
  location?: { travelFlowDirection?: string; begin?: Fields; end?: Fields };
  closure?: Closure;
}

interface LcsEntry {
  lcs?: Lcs;
}

function toNumber(text: string | undefined) {
  if (text === undefined || text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isActive(closure: Closure, nowSecs: number) {
  const stamp = closure.closureTimestamp;
  const start = toNumber(stamp?.closureStartEpoch);
  const end = toNumber(stamp?.closureEndEpoch);
  if (start === null || start > nowSecs) return false;
  if (stamp?.isClosureEndIndefinite === "true") return true;
  return end === null || end >= nowSecs;
}

function pointOf(fields: Fields | undefined, prefix: "begin" | "end"): [number, number] | null {
  const lng = toNumber(fields?.[`${prefix}Longitude`]);
  const lat = toNumber(fields?.[`${prefix}Latitude`]);
  return lng === null || lat === null ? null : [lng, lat];
}

const samePoint = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];

function geometryOf(lcs: Lcs): Geometry | null {
  const begin = pointOf(lcs.location?.begin, "begin");
  const end = pointOf(lcs.location?.end, "end");
  if (!begin) return null;
  if (!end || samePoint(begin, end)) return { type: "Point", coordinates: begin };
  return { type: "LineString", coordinates: [begin, end] };
}

const placeOf = (fields: Fields, prefix: "begin" | "end") => fields[`${prefix}LocationName`] || fields[`${prefix}NearbyPlace`] || "";

function spanOf(from: string, to: string) {
  if (from && to && from !== to) return `${from} to ${to}`;
  return from || to;
}

function nameOf(lcs: Lcs) {
  const begin = lcs.location?.begin ?? {};
  const end = lcs.location?.end ?? {};
  const direction = lcs.location?.travelFlowDirection;
  const parts = [begin.beginRoute || "Road", spanOf(placeOf(begin, "begin"), placeOf(end, "end")), direction ? `(${direction})` : ""];
  return parts.filter(Boolean).join(" ");
}

function detailsOf(lcs: Lcs, closure: Closure) {
  return {
    closureType: closure.typeOfClosure ?? null,
    facility: closure.facility ?? null,
    typeOfWork: closure.typeOfWork ?? null,
    lanesClosed: closure.lanesClosed ?? null,
    totalExistingLanes: closure.totalExistingLanes ?? null,
    startsAt: toNumber(closure.closureTimestamp?.closureStartEpoch),
    endsAt: toNumber(closure.closureTimestamp?.closureEndEpoch),
    route: lcs.location?.begin?.beginRoute ?? null,
    district: lcs.location?.begin?.beginDistrict ?? null,
  };
}

function updatedAtOf(lcs: Lcs) {
  const epoch = toNumber(lcs.recordTimestamp?.recordEpoch);
  return epoch === null ? null : new Date(epoch * 1000).toISOString();
}

function wanted(closure: Closure | undefined, nowSecs: number, includeLanes: boolean): closure is Closure {
  if (!closure || !isActive(closure, nowSecs)) return false;
  return includeLanes || closure.typeOfClosure === "Full";
}

function closureRecord(entry: LcsEntry, nowSecs: number, includeLanes: boolean): EvacuationRecord | null {
  const lcs = entry.lcs;
  const closure = lcs?.closure;
  if (!lcs?.index || !wanted(closure, nowSecs, includeLanes)) return null;
  const geometry = geometryOf(lcs);
  if (!geometry) return null;
  return {
    source: "caltrans-lcs",
    sourceUrl: districtUrl(Number(lcs.location?.begin?.beginDistrict) || 1),
    kind: "road_closure",
    id: lcs.index,
    name: nameOf(lcs),
    county: lcs.location?.begin?.beginCounty || null,
    status: closure.typeOfClosure === "Full" ? "closed" : "open",
    updatedAt: updatedAtOf(lcs),
    geometry,
    properties: detailsOf(lcs, closure),
  };
}

async function fetchDistrict(district: number, timeoutSecs: number, includeLanes: boolean, nowSecs: number) {
  const body = await fetchJson<{ data?: LcsEntry[] }>(districtUrl(district), timeoutSecs);
  return (body.data ?? []).map((entry) => closureRecord(entry, nowSecs, includeLanes)).filter((record): record is EvacuationRecord => record !== null);
}

export interface CaltransOutcome {
  records: EvacuationRecord[];
  failedDistricts: number[];
}

// A district feed that is down is skipped; the others still report.
export async function fetchClosures(timeoutSecs: number, includeLanes: boolean, nowSecs = Math.floor(Date.now() / 1000)): Promise<CaltransOutcome> {
  const settled = await Promise.allSettled(DISTRICTS.map((district) => fetchDistrict(district, timeoutSecs, includeLanes, nowSecs)));
  const records: EvacuationRecord[] = [];
  const failedDistricts: number[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") records.push(...result.value);
    else failedDistricts.push(DISTRICTS[index] as number);
  });
  if (failedDistricts.length === DISTRICTS.length) throw new Error("All Caltrans district feeds failed");
  return { records, failedDistricts };
}
