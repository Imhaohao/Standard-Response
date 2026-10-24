import { DocumentInfo, MossClient } from "@inferedge/moss";
import { existsSync, readFileSync } from "node:fs";
import { env } from "../env";
import { BANK_FILES, dialogDocs, INDEXES, PrincipleCard, principleDocs, Script } from "./bank";

// Pushes the principles database and the 911 dialog bank to Moss. Re-running it upserts by id, so a
// grown bank only adds its new turns.
//
//   npm run knowledge:index

const BATCH = 2000;

const linesOf = <T>(file: string): T[] => {
  if (!existsSync(file)) throw new Error(`${file} is missing; run npm run knowledge:generate first`);
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as T);
};

async function upsert(client: MossClient, name: string, docs: DocumentInfo[]) {
  const existing = new Set((await client.listIndexes()).map((index) => index.name));
  for (let start = 0; start < docs.length; start += BATCH) {
    const batch = docs.slice(start, start + BATCH);
    const isNew = start === 0 && !existing.has(name);
    await (isNew ? client.createIndex(name, batch, { modelId: "moss-minilm" }) : client.addDocs(name, batch, { upsert: true }));
    console.log(`[${name}] ${Math.min(start + BATCH, docs.length)} of ${docs.length} documents`);
  }
}

async function main() {
  if (!env.moss.projectId || !env.moss.projectKey) throw new Error("Set MOSS_PROJECT_ID and MOSS_PROJECT_KEY in .env.local");
  const client = new MossClient(env.moss.projectId, env.moss.projectKey);
  await upsert(client, INDEXES.principles, linesOf<PrincipleCard>(BANK_FILES.principles).flatMap(principleDocs));
  await upsert(client, INDEXES.dialogs, linesOf<Script>(BANK_FILES.scripts).flatMap(dialogDocs));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
