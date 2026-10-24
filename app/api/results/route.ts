import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

// Tracks B, C and D write these files; the under-the-hood screen reads them.
const RESULT_FILES = {
  simulator: "sim-results.json",
  evaluation: "eval-results.json",
  honesty: "honesty-results.json",
  doorFairness: "door-fairness.json",
  changeCases: "redteam-change-cases.json",
} as const;

async function readResult(file: string) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", file), "utf8"));
  } catch {
    return null;
  }
}

export async function GET() {
  await connection();
  const entries = await Promise.all(
    Object.entries(RESULT_FILES).map(async ([key, file]) => [key, await readResult(file)] as const),
  );
  return Response.json(Object.fromEntries(entries));
}
