/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { registerHouseholdCounts } from "../workflow/householdCounts";
import { ElasticLike, indexDocuments, searchIndex, ensureIndex } from "../../convex/elasticCore";
import { householdDocument, householdSource, INDEX_MAPPINGS, INDEX_NAME, lineDocument, redactPhoneNumbers, shapeHits } from "../../convex/elasticDocs";

// Run with: npx vitest run tests/elastic --environment edge-runtime

const modules = import.meta.glob("../../convex/**/*.ts");

function fakeClient(options: { indexExists?: boolean; hits?: unknown[] } = {}) {
  const calls = { exists: 0, create: 0, bulk: [] as unknown[][], search: [] as unknown[] };
  const client: ElasticLike = {
    indices: {
      exists: async () => {
        calls.exists += 1;
        return options.indexExists ?? calls.create > 0;
      },
      create: async () => {
        calls.create += 1;
      },
    },
    bulk: async ({ operations }) => {
      calls.bulk.push(operations);
      return { errors: false };
    },
    search: async (params) => {
      calls.search.push(params);
      return { hits: { hits: (options.hits ?? []) as never[] } };
    },
  };
  return { client, calls };
}

describe("without Elastic credentials", () => {
  test("indexing does nothing and search returns no results", async () => {
    vi.stubEnv("ELASTIC_URL", "");
    vi.stubEnv("ELASTIC_API_KEY", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const t = convexTest(schema, modules);
    registerHouseholdCounts(t);
    const { householdId, lineId } = await t.run(async (ctx) => {
      const householdId = await ctx.db.insert("households", {
        address: "490 Mar Vista Ave",
        callbackNumber: "+16265550142",
        language: "es",
        callStatus: "not_called",
        outcome: "unknown",
        inZone: true,
        attempts: 1,
        needPrior: 0.2,
        needProbability: 0.2,
        fireArrivalAt: Date.now(),
        callPriority: 0.2,
        simulated: false,
      });
      const callId = await ctx.db.insert("calls", {
        householdId,
        direction: "outbound",
        phase: "live",
        stage: "greet",
        language: "es",
        attempt: 1,
        startedAt: Date.now(),
        simulated: false,
      });
      const lineId = await ctx.db.insert("transcriptLines", { callId, speaker: "resident", text: "Necesito oxígeno", at: Date.now() });
      return { householdId, lineId };
    });
    await expect(t.action(internal.elastic.indexLine, { lineId })).resolves.toBeNull();
    await expect(t.action(internal.elastic.indexHousehold, { householdId })).resolves.toBeNull();
    await expect(t.action(internal.elastic.backfill, {})).resolves.toBeNull();
    await expect(t.action(api.elastic.search, { q: "oxygen" })).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("ELASTIC_URL"));
    vi.unstubAllEnvs();
    log.mockRestore();
  });
});

describe("documents", () => {
  const home = { _id: "h1", address: "490 Mar Vista Ave", language: "es", mobility: "power_wheelchair", medical: ["oxygen"], peopleCount: 2 };

  test("never carry a phone number", () => {
    const withPhone = { ...home, callbackNumber: "+16265550142", residentName: "Boris" };
    const household = householdDocument(householdSource(withPhone));
    const line = lineDocument({
      lineId: "l1",
      householdId: "h1",
      callId: "c1",
      address: home.address,
      language: "es",
      speaker: "resident",
      text: "Mi número es 626 555 0142, necesito oxígeno",
      at: 1,
    });
    const serialized = JSON.stringify([household, line]);
    expect(serialized).not.toMatch(/626|callbackNumber|Boris/);
    expect(Object.keys(household.body).sort()).toEqual(["address", "householdId", "kind", "language", "summary"]);
    expect(line.body.text).toContain("oxígeno");
  });

  test("describe a home by its needs", () => {
    expect(householdSource(home).summary).toBe("mobility power wheelchair, medical oxygen, people 2");
  });

  test("redaction keeps short numbers like a street number", () => {
    expect(redactPhoneNumbers("my neighbor at 490 needs help")).toBe("my neighbor at 490 needs help");
    expect(redactPhoneNumbers("call (626) 555-0142 please")).toBe("call [number removed] please");
  });

  test("mappings analyze text three ways", () => {
    expect(INDEX_MAPPINGS.properties.text.analyzer).toBe("standard");
    expect(INDEX_MAPPINGS.properties.text.fields.es.analyzer).toBe("spanish");
    expect(INDEX_MAPPINGS.properties.text.fields.cjk.analyzer).toBe("cjk");
  });
});

describe("the index", () => {
  test("is created once however many times it is ensured", async () => {
    const { client, calls } = fakeClient();
    await ensureIndex(client);
    await ensureIndex(client);
    await indexDocuments(client, [householdDocument({ householdId: "h1", address: "a", language: "en", summary: "" })]);
    expect(calls.create).toBe(1);
  });

  test("is not created when it exists already", async () => {
    const { client, calls } = fakeClient({ indexExists: true });
    await ensureIndex(client);
    expect(calls.create).toBe(0);
  });

  test("bulk operations pair an action with a document", async () => {
    const { client, calls } = fakeClient({ indexExists: true });
    await indexDocuments(client, [householdDocument({ householdId: "h1", address: "a", language: "en", summary: "s" })]);
    expect(calls.bulk[0][0]).toEqual({ index: { _index: INDEX_NAME, _id: "household:h1" } });
  });
});

describe("search", () => {
  const hits = [
    { _source: { kind: "line", householdId: "h1", callId: "c1", address: "490 Mar Vista Ave", at: 5, text: "I need oxygen" }, highlight: { text: ["I need [[oxygen]]"] } },
    { _source: { kind: "household", householdId: "h2", address: "12 Lake Ave", summary: "medical oxygen" } },
    { _source: { kind: "line" } },
  ];

  test("shapes hits into results and drops broken ones", () => {
    expect(shapeHits(hits)).toEqual([
      { householdId: "h1", address: "490 Mar Vista Ave", snippet: "I need [[oxygen]]", callId: "c1", at: 5 },
      { householdId: "h2", address: "12 Lake Ave", snippet: "medical oxygen" },
    ]);
  });

  test("asks for fuzzy matches in all three analyzers and filters by language", async () => {
    const { client, calls } = fakeClient({ indexExists: true, hits });
    const results = await searchIndex(client, "oxygen", "es");
    expect(results).toHaveLength(2);
    const body = calls.search[0] as { query: { bool: { must: { multi_match: { fuzziness: string; fields: string[] } }[]; filter: unknown[] } }; size: number };
    expect(body.size).toBe(20);
    expect(body.query.bool.must[0].multi_match.fuzziness).toBe("AUTO");
    expect(body.query.bool.must[0].multi_match.fields).toEqual(expect.arrayContaining(["text", "text.es", "text.cjk"].map((f) => expect.stringContaining(f))));
    expect(body.query.bool.filter).toEqual([{ term: { language: "es" } }]);
  });
});
