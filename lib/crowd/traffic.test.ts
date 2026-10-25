import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EDGES, freeFlow, shortestPathsFrom } from "../../convex/roadGraph";
import { DispatchTraffic, timeFactor, trafficEdgeTime } from "../../convex/traffic";

// The dispatcher's drive times in forecast traffic (convex/traffic.ts).

const BASE_AT = 1_000_000;
const edge = EDGES.findIndex((e) => e.seconds >= 20);
const free = EDGES[edge].seconds;
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

const traffic = (slowdowns: number[], to = [15, 30, 60]): DispatchTraffic => ({
  baseAt: BASE_AT,
  windows: slowdowns.map((slowdown, k) => ({ from: k === 0 ? 0 : to[k - 1], to: to[k], edges: slowdown > 0 ? [{ key: EDGES[edge].key, slowdown }] : [] })),
});

describe("traffic in the dispatcher's drive times", () => {
  it("drives at free flow with no forecast", () => {
    assert.equal(trafficEdgeTime(null, BASE_AT), freeFlow);
  });

  it("stretches a street by its forecast slowdown, and leaves the others alone", () => {
    const edgeTime = trafficEdgeTime(traffic([0.5, 0.5, 0.5]), BASE_AT);
    near(edgeTime(edge, 0), free * 2);
    const other = EDGES.findIndex((_, e) => e !== edge);
    near(edgeTime(other, 0), EDGES[other].seconds);
  });

  it("stops at the crowd model's standstill floor", () => {
    assert.equal(timeFactor(1), 20);
    near(trafficEdgeTime(traffic([1, 1, 1]), BASE_AT)(edge, 0), free * 20);
  });

  it("drives the rest of a street at the next window's speed once the window ends", () => {
    // Half speed until 15 minutes after the forecast began; the drive enters 10 s before that.
    const edgeTime = trafficEdgeTime(traffic([0.5, 0, 0]), BASE_AT);
    const at = 15 * 60 - 10;
    near(edgeTime(edge, at), 10 + (free - 5));
  });

  it("counts windows from the forecast's start, not from now", () => {
    // Ten minutes into the forecast, the first window has five minutes left.
    const edgeTime = trafficEdgeTime(traffic([0.5, 0, 0]), BASE_AT + 10 * 60_000);
    near(edgeTime(edge, 0), free * 2);
    near(edgeTime(edge, 5 * 60), free);
  });

  it("holds the last window past the forecast's horizon", () => {
    const edgeTime = trafficEdgeTime(traffic([0, 0, 0.75]), BASE_AT);
    near(edgeTime(edge, 3 * 3600), free * 4);
  });

  it("never arrives sooner by leaving later", () => {
    const edgeTime = trafficEdgeTime(traffic([0.9, 0, 0.6]), BASE_AT + 3 * 60_000);
    let previous = -Infinity;
    for (let at = 0; at < 3600; at += 7) {
      const arrival = at + edgeTime(edge, at);
      assert.ok(arrival >= previous - 1e-9, `leaving at ${at} s arrives at ${arrival}, before ${previous}`);
      previous = arrival;
    }
  });

  it("finds paths no faster than free flow, and slower through a jammed street", () => {
    const jammed = trafficEdgeTime(traffic([0.95, 0.95, 0.95]), BASE_AT);
    const before = shortestPathsFrom(EDGES[edge].u, new Set());
    const after = shortestPathsFrom(EDGES[edge].u, new Set(), jammed);
    for (let node = 0; node < before.seconds.length; node++) {
      if (Number.isFinite(before.seconds[node])) assert.ok(after.seconds[node] >= before.seconds[node] - 1e-9);
    }
    // The test street is the fastest way between its ends at free flow, and isn't once it jams.
    near(before.seconds[EDGES[edge].v], free);
    assert.ok(after.seconds[EDGES[edge].v] > free);
  });
});
