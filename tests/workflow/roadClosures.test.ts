/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { escapeRoute } from "../../convex/escapeRoute";
import { EDGES, nearestNode, nodePoint } from "../../convex/roadGraph";
import { SHELTERS } from "../../convex/seed";

// Run with: npx vitest run tests/workflow/roadClosures.test.ts --environment edge-runtime
// A closure is snapped to the road graph as it's written, so a caller's way out avoids it right
// away, even while the dispatch stand-in (which never snaps closures) is running.

const modules = import.meta.glob("../../convex/**/*.ts");

const HOME = { lat: 34.1905, lng: -118.155 };

describe("road closures", () => {
  test("a closure drawn as a path shuts its streets for every router the moment it's added", async () => {
    const t = convexTest(schema, modules);
    const node = nearestNode(HOME);
    const corner = EDGES.filter((edge) => edge.u === node || edge.v === node);
    expect(escapeRoute(HOME, SHELTERS, [])).not.toBeNull();

    const closures = corner.map((edge) => ({ path: [nodePoint(edge.u), nodePoint(edge.v)], source: "hazard" as const }));
    expect(await t.mutation(api.roads.addClosures, { closures })).toBe(corner.length);

    const rows = await t.query(api.roads.closures, {});
    for (const row of rows) expect(row.edgeKeys?.length).toBeGreaterThan(0);
    expect(escapeRoute(HOME, SHELTERS, rows)).toBeNull();
  });

  test("a short piece of a long curved street, as the Close this road control cuts it, closes that street", async () => {
    const t = convexTest(schema, modules);
    const street = EDGES.find((edge) => edge.meters > 300 && (edge.geometry?.length ?? 0) >= 6)!;
    const middle = Math.floor(street.geometry!.length / 2);
    const piece = street.geometry!.slice(middle, middle + 2).map(([lat, lng]) => ({ lat, lng }));
    await t.mutation(api.roads.addClosures, { closures: [{ path: piece, source: "manual" }] });
    const [row] = await t.query(api.roads.closures, {});
    expect(row.edgeKeys).toContain(street.key);
  });
});
