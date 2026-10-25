import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { dedupeIncidents } from "./filters.js";
import {
  BlockedError,
  configureBrightData,
  fetchJson,
  fetchStats,
  resetFetchStats,
  resolveBrightData,
  withSourceLabel,
} from "./http.js";
import { fetchIncidents, fetchWebIncidents } from "./sources/incidents.js";

const INCIDENT = {
  Name: "Cooley Fire",
  UniqueId: "abc-123",
  Updated: "2026-10-24T12:00:00Z",
  County: "Mendocino",
  Longitude: -123.1,
  Latitude: 39.2,
  IsActive: true,
  Final: false,
};

interface Call {
  url: string;
  init: RequestInit;
}

function fakeNetwork(t: { mock: { method: (...args: never[]) => unknown } }, respond: (call: Call) => Response) {
  const calls: Call[] = [];
  (t.mock.method as (target: object, name: string, impl: unknown) => unknown)(globalThis, "fetch", async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  });
  return calls;
}

beforeEach(() => {
  configureBrightData(undefined);
  resetFetchStats();
});
afterEach(() => configureBrightData(undefined));

test("an unblock request goes direct when Bright Data is not configured", async (t) => {
  const calls = fakeNetwork(t, () => Response.json([INCIDENT]));
  const records = await fetchWebIncidents(5);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://www.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false");
  assert.equal(records.length, 1);
  assert.deepEqual(fetchStats().fetchedVia, { direct: 1, brightData: 0 });
});

test("an unblock request goes through the Bright Data Web Unlocker API when configured", async (t) => {
  configureBrightData({ apiKey: "key-1", zone: "unlocker_zone" });
  const calls = fakeNetwork(t, () => Response.json([INCIDENT]));
  const records = await fetchWebIncidents(5);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.brightdata.com/request");
  assert.equal(calls[0]!.init.method, "POST");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer key-1");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), {
    zone: "unlocker_zone",
    url: "https://www.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false",
    format: "raw",
  });
  assert.equal(records[0]!.source, "cal-fire-incidents-web");
  assert.equal(records[0]!.kind, "incident");
  assert.deepEqual(fetchStats().fetchedVia, { direct: 0, brightData: 1 });
});

test("a source that is not marked unblock stays direct even when Bright Data is configured", async (t) => {
  configureBrightData({ apiKey: "key-1", zone: "z" });
  const calls = fakeNetwork(t, () => Response.json([INCIDENT]));
  await fetchIncidents(5);
  assert.equal(calls[0]!.url, "https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false");
  assert.deepEqual(fetchStats().fetchedVia, { direct: 1, brightData: 0 });
});

test("a direct 403 is reported as blocked under its source", async (t) => {
  fakeNetwork(t, () => new Response("<HTML><TITLE>Access Denied</TITLE></HTML>", { status: 403 }));
  await assert.rejects(withSourceLabel("calFireWebIncidents", () => fetchWebIncidents(5)), /HTTP 403/);
  assert.deepEqual(fetchStats().blocked, { calFireWebIncidents: 1 });
  assert.deepEqual(fetchStats().fetchedVia, { direct: 0, brightData: 0 });
});

test("a challenge page served with status 200 is reported as blocked", async (t) => {
  fakeNetwork(t, () => new Response("<html><body>Just a moment... captcha</body></html>", { status: 200 }));
  await assert.rejects(withSourceLabel("calFireWebIncidents", () => fetchJson("https://example.test/x", 5)), BlockedError);
  assert.deepEqual(fetchStats().blocked, { calFireWebIncidents: 1 });
});

test("a Bright Data error is not counted as a direct block", async (t) => {
  configureBrightData({ apiKey: "bad", zone: "z" });
  fakeNetwork(t, () => new Response("unauthorized", { status: 401 }));
  await assert.rejects(fetchWebIncidents(5), /HTTP 401 .*via Bright Data/);
  assert.deepEqual(fetchStats().blocked, {});
});

test("Bright Data credentials come from the input first and the environment second", () => {
  const env = { BRIGHTDATA_API_KEY: "env-key", BRIGHTDATA_ZONE: "env-zone" } as NodeJS.ProcessEnv;
  assert.deepEqual(resolveBrightData({}, env), { apiKey: "env-key", zone: "env-zone" });
  assert.deepEqual(resolveBrightData({ brightDataApiKey: "in-key", brightDataZone: "in-zone" }, env), { apiKey: "in-key", zone: "in-zone" });
  assert.equal(resolveBrightData({ brightDataApiKey: "only-key" }, {} as NodeJS.ProcessEnv), undefined);
});

test("the same fire from both CAL FIRE hosts is kept once", async (t) => {
  fakeNetwork(t, () => Response.json([INCIDENT]));
  const direct = await fetchIncidents(5);
  configureBrightData({ apiKey: "k", zone: "z" });
  const web = await fetchWebIncidents(5);
  const merged = dedupeIncidents([...direct, ...web]);
  assert.deepEqual(merged.map((record) => record.source), ["cal-fire-incidents"]);
});
