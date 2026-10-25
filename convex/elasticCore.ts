import { IndexedDocument, INDEX_MAPPINGS, INDEX_NAME, SearchHit, searchBody, shapeHits } from "./elasticDocs";

// The few Elasticsearch calls this app makes. The real @elastic/elasticsearch Client satisfies it,
// and tests pass a fake.
export type ElasticLike = {
  indices: {
    exists: (params: { index: string }) => Promise<boolean>;
    create: (params: { index: string; mappings: unknown }) => Promise<unknown>;
  };
  bulk: (params: { operations: unknown[] }) => Promise<{ errors: boolean }>;
  search: (params: { index: string } & ReturnType<typeof searchBody>) => Promise<{ hits: { hits: SearchHit[] } }>;
  deleteByQuery: (params: { index: string; query: unknown }) => Promise<unknown>;
};

export type ElasticEnv = { ELASTIC_URL?: string; ELASTIC_API_KEY?: string };

export function elasticConfigured(env: ElasticEnv) {
  return Boolean(env.ELASTIC_URL && env.ELASTIC_API_KEY);
}

// Creating an index that already exists is an error, so check first; a parallel creator that wins the race is fine.
const clientsWithIndex = new WeakSet<ElasticLike>();

export async function ensureIndex(client: ElasticLike) {
  if (clientsWithIndex.has(client)) return;
  if (!(await client.indices.exists({ index: INDEX_NAME }))) await createIndex(client);
  clientsWithIndex.add(client);
}

async function createIndex(client: ElasticLike) {
  try {
    await client.indices.create({ index: INDEX_NAME, mappings: INDEX_MAPPINGS });
  } catch (error) {
    if (!String(error).includes("resource_already_exists_exception")) throw error;
  }
}

export async function indexDocuments(client: ElasticLike, documents: IndexedDocument[]) {
  if (documents.length === 0) return;
  await ensureIndex(client);
  const operations = documents.flatMap((doc) => [{ index: { _index: INDEX_NAME, _id: doc.id } }, doc.body]);
  const response = await client.bulk({ operations });
  if (response.errors) throw new Error("Elasticsearch rejected some documents");
}

export async function searchIndex(client: ElasticLike, q: string, language?: string) {
  await ensureIndex(client);
  const response = await client.search({ index: INDEX_NAME, ...searchBody(q, language) });
  return shapeHits(response.hits.hits);
}

// Closing the incident deletes real homes from Convex; their household and transcript documents go too.
export async function forgetHouseholds(client: ElasticLike, householdIds: string[]) {
  if (householdIds.length === 0) return;
  if (!(await client.indices.exists({ index: INDEX_NAME }))) return;
  await client.deleteByQuery({ index: INDEX_NAME, query: { terms: { householdId: householdIds } } });
}
