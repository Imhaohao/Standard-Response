"use client";

import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { LatLng } from "@/lib/geo";
import { GraphEdge, InkMapData, Point } from "@/lib/ink-map/data";
import { nearestStreetBlock, streetName } from "@/lib/ink-map/road-route";
import { nearestCorner, StreetNetwork, streetNetwork, streetsBetweenCorners } from "@/lib/ink-map/street-network";
import { MapTool } from "./map-chrome";

const CORNER_REACH_METERS = 150;
const STREET_REACH_METERS = 45;

export type StreetPick = { edge: GraphEdge; name: string | null };

// A warning zone is drawn corner by corner. Every corner is a street corner, and the edge between
// two corners runs along the streets, so the zone's boundary is a line a crew can actually drive.
export type ZoneDraft = {
  corners: Point[];
  boundary: Point[];
  closing: Point[];
  preview: Point[];
  previewCrosses: boolean;
  hoveringFirst: boolean;
  target: Point | null;
};

function cross([ox, oy]: Point, [ax, ay]: Point, [bx, by]: Point) {
  return (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  return cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
}

// Whether a new edge would cut across the boundary drawn so far, which would tie the zone in a knot.
function crossesBoundary(leg: Point[], boundary: Point[]) {
  for (let i = 1; i < leg.length; i++) {
    for (let j = 1; j < boundary.length; j++) {
      if (segmentsCross(leg[i - 1], leg[i], boundary[j - 1], boundary[j])) return true;
    }
  }
  return false;
}

function joinLegs(legs: Point[][]) {
  const joined: Point[] = [];
  for (const leg of legs) {
    for (const point of leg) {
      const last = joined[joined.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) joined.push(point);
    }
  }
  return joined;
}

const startingDraft = (target: Point | null): ZoneDraft => ({ corners: [], boundary: [], closing: [], preview: [], previewCrosses: false, hoveringFirst: false, target });

function zoneDraft(network: StreetNetwork | null, corners: number[], hoverNode: number | null): ZoneDraft | null {
  if (!network) return null;
  const target = hoverNode === null ? null : network.points[hoverNode];
  if (corners.length === 0) return startingDraft(target);
  const legs = corners.slice(1).map((corner, index) => streetsBetweenCorners(network, corners[index], corner));
  const boundary = joinLegs([[network.points[corners[0]]], ...legs]);
  const last = corners[corners.length - 1];
  const closing = corners.length >= 3 ? streetsBetweenCorners(network, last, corners[0]) : [];
  const hoveringFirst = corners.length >= 3 && hoverNode === corners[0];
  const preview = hoverNode !== null && hoverNode !== last ? streetsBetweenCorners(network, last, hoverNode) : [];
  return {
    corners: corners.map((corner) => network.points[corner]),
    boundary,
    closing,
    preview,
    previewCrosses: !hoveringFirst && preview.length > 0 && crossesBoundary(preview, boundary.slice(0, -1)),
    hoveringFirst,
    target,
  };
}

function useZoneDrawing(data: InkMapData | null, toLatLng: (point: Point) => LatLng, onSaved: (status: string) => void) {
  const [corners, setCorners] = useState<number[]>([]);
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const setZone = useMutation(api.riders.setZone);
  const network = useMemo(() => (data ? streetNetwork(data) : null), [data]);
  const draft = useMemo(() => zoneDraft(network, corners, hoverNode), [network, corners, hoverNode]);

  const save = useCallback(async () => {
    if (!draft || draft.corners.length < 3) return;
    const ring = joinLegs([draft.boundary, draft.closing]);
    const covered = await setZone({ polygon: ring.map(toLatLng) });
    setCorners([]);
    onSaved(`Zone saved with ${covered} homes inside`);
  }, [draft, setZone, toLatLng, onSaved]);

  const place = useCallback(
    (point: Point) => {
      const node = network && nearestCorner(network, point, CORNER_REACH_METERS);
      if (node === null) return;
      if (draft?.hoveringFirst && node === corners[0]) return void save();
      if (draft?.previewCrosses) return;
      setCorners((current) => (current[current.length - 1] === node ? current : [...current, node]));
    },
    [network, draft, corners, save],
  );

  const hover = useCallback((point: Point | null) => setHoverNode(point && network ? nearestCorner(network, point, CORNER_REACH_METERS) : null), [network]);
  const undo = useCallback(() => setCorners((current) => current.slice(0, -1)), []);
  const clear = useCallback(() => setCorners([]), []);
  return { draft, place, hover, undo, clear, save };
}

function useStreetClosing(data: InkMapData | null, toLatLng: (point: Point) => LatLng, onClosed: (status: string) => void) {
  const [street, setStreet] = useState<StreetPick | null>(null);
  const addClosures = useMutation(api.roads.addClosures);

  const pickAt = useCallback(
    (point: Point | null): StreetPick | null => {
      const edge = point && data ? nearestStreetBlock(data, point, STREET_REACH_METERS) : null;
      return edge && data ? { edge, name: streetName(data, edge) } : null;
    },
    [data],
  );

  const hover = useCallback((point: Point | null) => setStreet((current) => {
    const next = pickAt(point);
    return next?.edge.key === current?.edge.key ? current : next;
  }), [pickAt]);

  const close = useCallback(
    async (point: Point) => {
      const pick = pickAt(point);
      if (!pick) return;
      await addClosures({ closures: [{ edgeKey: pick.edge.key, path: pick.edge.shape.map(toLatLng), source: "manual" }] });
      onClosed(`${pick.name ?? "Street"} closed`);
    },
    [pickAt, addClosures, toLatLng, onClosed],
  );
  const clear = useCallback(() => setStreet(null), []);
  return { street, hover, close, clear };
}

// Enter saves the zone, Backspace takes back its last corner, Escape puts the tool down. None of
// them fire while someone is typing, and Enter on a focused button still presses that button.
function ignoresKey(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return true;
  return event.key === "Enter" && Boolean(target?.closest("button, a"));
}

function useDrawingKeys(active: boolean, handlers: { onEnter: () => void; onBackspace: () => void; onEscape: () => void }) {
  const { onEnter, onBackspace, onEscape } = handlers;
  useEffect(() => {
    if (!active) return;
    const keys: Record<string, () => void> = { Enter: onEnter, Backspace: onBackspace, Escape: onEscape };
    const onKey = (event: KeyboardEvent) => {
      const handler = keys[event.key];
      if (!handler || ignoresKey(event)) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onEnter, onBackspace, onEscape]);
}

export function useDrawingTools(data: InkMapData | null, toLatLng: (point: Point) => LatLng) {
  const [tool, setToolState] = useState<MapTool>("look");
  const [status, setStatus] = useState("");
  const zone = useZoneDrawing(data, toLatLng, setStatus);
  const streets = useStreetClosing(data, toLatLng, setStatus);
  const { clear: clearZone } = zone;
  const { clear: clearStreet } = streets;

  const setTool = useCallback(
    (next: MapTool) => {
      setToolState(next);
      setStatus("");
      clearZone();
      clearStreet();
    },
    [clearZone, clearStreet],
  );

  const pick = useCallback(
    (point: Point) => {
      setStatus("");
      if (tool === "zone") zone.place(point);
      if (tool === "closure") void streets.close(point);
    },
    [tool, zone, streets],
  );

  const hover = useCallback(
    (point: Point | null) => {
      if (tool === "zone") zone.hover(point);
      if (tool === "closure") streets.hover(point);
    },
    [tool, zone, streets],
  );

  // A tool started from the map's right-click menu acts on that spot straight away.
  const startFrom = useCallback(
    (action: MapTool, point: Point) => {
      setTool(action);
      if (action === "zone") zone.place(point);
      if (action === "closure") void streets.close(point);
    },
    [setTool, zone, streets],
  );

  const cancel = useCallback(() => setTool("look"), [setTool]);
  const saveZone = useCallback(() => void zone.save(), [zone]);
  useDrawingKeys(tool !== "look", { onEnter: saveZone, onBackspace: zone.undo, onEscape: cancel });

  return {
    tool,
    setTool,
    status,
    pick,
    hover: tool === "look" ? undefined : hover,
    startFrom,
    zone: zone.draft,
    undoCorner: zone.undo,
    saveZone,
    street: tool === "closure" ? streets.street : null,
  };
}
