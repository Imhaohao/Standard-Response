import { APPROVED_ANSWER_INDEX, approvedAnswerDocuments, mossClient } from "../../voice/agent/answerLookup";

// Rebuilds the Moss index of approved answers from voice/agent/approvedAnswers.ts. Run it after
// changing the bank, then restart the voice server so it loads the new index.
//
//   npm run moss:index

async function main() {
  const moss = mossClient();
  if (!moss) throw new Error("Set MOSS_PROJECT_ID and MOSS_PROJECT_KEY in .env.local");
  const existing = await moss.listIndexes();
  if (existing.some((index) => index.name === APPROVED_ANSWER_INDEX)) await moss.deleteIndex(APPROVED_ANSWER_INDEX);
  const documents = approvedAnswerDocuments();
  await moss.createIndex(APPROVED_ANSWER_INDEX, documents, { modelId: "moss-minilm" });
  console.log(`Built ${APPROVED_ANSWER_INDEX}: ${documents.length} questions`);
}

void main();
