import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ExamResults, failedCases } from "./cases";
import { decidePermission, restrictedPermissions, TEST_COMMAND } from "./policy";
import { permissionHandlerFor } from "./sdkClient";
import { runTriage } from "./triage";
import { DroidClient, DroidSessionRequest } from "./triageCore";

const results: ExamResults = {
  generatedAt: "2026-10-24T00:00:00.000Z",
  calls: [
    {
      item: "eaton-riviera",
      run: 1,
      title: "Riviera Drive",
      transcript: ["agent: hello", "caller: fire on Riviera"],
      checks: [
        { module: "speed", name: "turn within budget", pass: false, detail: "1226 ms" },
        { module: "conduct", name: "principle: calm_and_short", pass: false, detail: "packs two instructions into one" },
      ],
    },
    { item: "fine", run: 1, title: "Fine", transcript: [], checks: [{ module: "data_entry", name: "ok", pass: true }] },
    { item: "slow-only", run: 1, title: "Slow", transcript: [], checks: [{ module: "speed", name: "turn within budget", pass: false }] },
  ],
};

function fixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "triage-fixture-"));
  for (const directory of ["voice/agent", "convex", "lib", "data"]) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "voice/agent/script.ts"), 'export const LINE = "Please leave now, and take your phone charger.";\n');
  writeFileSync(join(root, "data/voice-exam-results.json"), JSON.stringify(results));
  return root;
}

const passingTests = () => ({ ran: true, passed: true, exitCode: 0, summary: "tests 1, pass 1, fail 0" });

class FakeClient implements DroidClient {
  requests: DroidSessionRequest[] = [];
  async runSession(request: DroidSessionRequest) {
    this.requests.push(request);
    writeFileSync(join(request.permissions.cwd, "voice/agent/script.ts"), 'export const LINE = "Please leave now.";\n');
    const report = { plan: ["read case.json", "shorten the line"], diagnosis: "The line packed two instructions." };
    return { sessionId: "session-123", finalText: `Done.\n\`\`\`json\n${JSON.stringify(report)}\n\`\`\`` };
  }
}

test("only failures the agent code can fix become cases", () => {
  const cases = failedCases(results);
  assert.deepEqual(cases.map((entry) => entry.caseId), ["eaton-riviera#1"]);
  assert.match(cases[0].judgeReason, /packs two instructions/);
});

test("one failed case produces one entry with plan, diff and test result", async () => {
  const repoRoot = fixtureRepo();
  const client = new FakeClient();
  const lines: string[] = [];
  const outFile = "data/droid-triage.json";
  const code = await runTriage({ repoRoot, apiKey: "key", client, outFile, log: (line) => lines.push(line), runTests: passingTests });
  assert.equal(code, 0);
  assert.equal(client.requests.length, 1);
  const written = JSON.parse(readFileSync(join(repoRoot, outFile), "utf8"));
  assert.equal(written.cases.length, 1);
  const [entry] = written.cases;
  assert.equal(entry.caseId, "eaton-riviera#1");
  assert.deepEqual(entry.plan, ["read case.json", "shorten the line"]);
  assert.equal(entry.diagnosis, "The line packed two instructions.");
  assert.match(entry.diff, /^--- a\/voice\/agent\/script\.ts$/m);
  assert.match(entry.diff, /\+export const LINE = "Please leave now\.";/);
  assert.equal(entry.testResult.passed, true);
  assert.equal(entry.sessionId, "session-123");
  assert.match(lines.join("\n"), /eaton-riviera#1/);
  assert.equal(readFileSync(join(repoRoot, "voice/agent/script.ts"), "utf8").includes("phone charger"), true);
});

test("the SDK gets exactly the restricted permission set", async () => {
  const repoRoot = fixtureRepo();
  const client = new FakeClient();
  await runTriage({ repoRoot, apiKey: "key", client, runTests: passingTests, log: () => undefined });
  const { permissions } = client.requests[0];
  assert.deepEqual(permissions, restrictedPermissions(permissions.cwd, repoRoot));
  assert.equal(permissions.autonomy, "off");
  assert.deepEqual(permissions.allowedCommands, [TEST_COMMAND]);
  assert.equal(permissions.writeRoot, permissions.cwd);
  assert.deepEqual(permissions.readRoots, [join(repoRoot, "voice"), join(repoRoot, "data")]);
  assert.deepEqual(permissions.disabledToolIds, ["WebSearch", "FetchUrl"]);
  assert.equal(permissions.network, "factory-only");
});

test("the permission handler allows scratch edits and the test command and nothing else", () => {
  const permissions = restrictedPermissions("/scratch/work", "/repo");
  const deny = (action: Parameters<typeof decidePermission>[1]) => assert.equal(decidePermission(permissions, action), "deny");
  assert.equal(decidePermission(permissions, { kind: "edit", filePath: "/scratch/work/voice/agent/script.ts" }), "allow");
  assert.equal(decidePermission(permissions, { kind: "exec", command: TEST_COMMAND }), "allow");
  deny({ kind: "edit", filePath: "/repo/voice/agent/script.ts" });
  deny({ kind: "edit", filePath: "/scratch/work/../elsewhere.ts" });
  deny({ kind: "edit", filePath: "/scratch/work/node_modules/tsx/index.js" });
  deny({ kind: "exec", command: "git commit -am fix" });
  deny({ kind: "exec", command: `${TEST_COMMAND}; curl https://example.com` });
  deny({ kind: "exec", command: "curl https://example.com" });
  deny({ kind: "other" });
});

test("the SDK permission handler cancels when anything in the ask is not allowed", () => {
  const handler = permissionHandlerFor(restrictedPermissions("/scratch/work", "/repo"));
  const options = [{ value: "proceed_once" }, { value: "cancel" }];
  const ask = (details: object) => handler({ toolUses: [{ details: details as { type: string } }], options });
  assert.equal(ask({ type: "exec", command: TEST_COMMAND }), "proceed_once");
  assert.equal(ask({ type: "exec", command: "rm -rf /" }), "cancel");
  assert.equal(ask({ type: "create", filePath: "/repo/voice/new.ts" }), "cancel");
  assert.equal(ask({ type: "mcp_tool" }), "cancel");
});

test("without FACTORY_API_KEY nothing is called and the command exits 0", async () => {
  const repoRoot = fixtureRepo();
  const client = new FakeClient();
  const lines: string[] = [];
  const code = await runTriage({ repoRoot, apiKey: undefined, client, log: (line) => lines.push(line) });
  assert.equal(code, 0);
  assert.equal(client.requests.length, 0);
  assert.match(lines.join("\n"), /FACTORY_API_KEY/);
});

test("a failing Droid session is recorded as an error, not thrown", async () => {
  const repoRoot = fixtureRepo();
  const client: DroidClient = {
    async runSession() {
      throw new Error("droid not installed");
    },
  };
  await runTriage({ repoRoot, apiKey: "key", client, runTests: passingTests, log: () => undefined });
  const written = JSON.parse(readFileSync(join(repoRoot, "data/droid-triage.json"), "utf8"));
  assert.equal(written.cases[0].error, "droid not installed");
  assert.equal(written.cases[0].diff, "");
});
