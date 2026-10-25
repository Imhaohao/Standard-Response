import assert from "node:assert/strict";
import { test } from "node:test";
import { descriptionFor, planSync, summaryFor } from "../src/issues.js";
import { runSync } from "../src/sync.js";
import { urgentAnswer } from "../src/urgent.js";

const config = { projectKey: "DOOR", issueType: "Task" };

const item = (id, overrides = {}) => ({
  householdId: id,
  rank: 1,
  address: `${id} Mariposa St`,
  lat: 34.19,
  lng: -118.15,
  needLevel: "high",
  needSummary: "uses a walker; needs one person to help",
  language: "es",
  reason: "Nobody reached the household after 3 call attempts.",
  attempts: 3,
  lastAttemptAt: Date.UTC(2026, 0, 9, 3, 30),
  statusNote: "3 attempts, outcome unreachable",
  ...overrides,
});

// An in-memory Jira: issues keyed by DOOR-n, with the same calls the real client makes.
function fakeJira(seed = []) {
  const issues = new Map(seed.map((issue) => [issue.key, { comments: [], ...issue }]));
  let next = seed.length + 1;
  return {
    issues,
    findDoorCheckIssues: async () =>
      [...issues.values()].map(({ key, householdId, fingerprint, statusCategory }) => ({ key, householdId, fingerprint, statusCategory })),
    createIssue: async (fields, property) => {
      const key = `DOOR-${next++}`;
      issues.set(key, { key, fields, ...property, statusCategory: "new", comments: [] });
      return key;
    },
    updateIssue: async (key, fields, property) => Object.assign(issues.get(key), { fields, ...property }),
    addComment: async (key, body) => issues.get(key).comments.push(body.content[0].content[0].text),
    transition: async (key, category) => {
      issues.get(key).statusCategory = category;
    },
    deleteIssue: async (key) => issues.delete(key),
  };
}

const existingIssue = (id, overrides = {}) => ({
  key: `DOOR-${id}`,
  householdId: `h${id}`,
  fingerprint: "3|3 attempts, outcome unreachable",
  statusCategory: "new",
  ...overrides,
});

const syncWith = (jira, queue, resolved = []) => runSync({ jira, config, fetchQueue: async () => ({ queue, resolved }) });

test("creates one issue per home, with the household id stored on it", async () => {
  const jira = fakeJira();
  const result = await syncWith(jira, [item("h1"), item("h2", { rank: 2 })]);
  assert.equal(result.actions, 2);
  const created = [...jira.issues.values()];
  assert.deepEqual(created.map((issue) => issue.householdId), ["h1", "h2"]);
  assert.equal(created[0].fields.summary, "Door check: h1 Mariposa St");
  assert.deepEqual(created[0].fields.labels, ["door-check"]);
  assert.equal(created[0].fields.project.key, "DOOR");
});

test("a second run with the same queue changes nothing", async () => {
  const jira = fakeJira();
  const queue = [item("h1"), item("h2", { rank: 2 })];
  await syncWith(jira, queue);
  const again = await syncWith(jira, queue);
  assert.equal(again.actions, 0);
  assert.equal(jira.issues.size, 2);
  assert.equal([...jira.issues.values()].every((issue) => issue.comments.length === 0), true);
});

test("a changed status updates the issue and adds one comment", async () => {
  const jira = fakeJira();
  await syncWith(jira, [item("h1")]);
  await syncWith(jira, [item("h1", { attempts: 4, statusNote: "4 attempts, outcome unreachable, flag: medical" })]);
  const issue = jira.issues.get("DOOR-1");
  assert.deepEqual(issue.comments, ["Status changed in the system: 4 attempts, outcome unreachable, flag: medical."]);
  assert.equal(issue.statusCategory, "new");
});

test("a home that was reached gets a comment and its issue is closed", async () => {
  const jira = fakeJira([existingIssue(1)]);
  await syncWith(jira, [], [{ householdId: "h1", status: "now complete, outcome leaving" }]);
  const issue = jira.issues.get("DOOR-1");
  assert.equal(issue.statusCategory, "done");
  assert.deepEqual(issue.comments, ["Closed: this home is now complete, outcome leaving."]);
});

test("an issue the crew closed stays closed until the system status changes, then reopens", async () => {
  const jira = fakeJira([existingIssue(1, { statusCategory: "done" })]);
  assert.equal((await syncWith(jira, [])).actions, 0);
  assert.equal((await syncWith(jira, [item("h1")])).actions, 0);
  await syncWith(jira, [item("h1", { attempts: 4, statusNote: "4 attempts, outcome unreachable" })]);
  const issue = jira.issues.get("DOOR-1");
  assert.equal(issue.statusCategory, "new");
  assert.match(issue.comments[0], /^Reopened/);
});

test("one failing issue does not stop the others", async () => {
  const jira = fakeJira();
  const create = jira.createIssue;
  jira.createIssue = async (fields, property) => {
    if (property.householdId === "h1") throw new Error("Jira answered 400");
    return create(fields, property);
  };
  const result = await syncWith(jira, [item("h1"), item("h2", { rank: 2 })]);
  assert.equal(result.failures.length, 1);
  assert.equal(jira.issues.size, 1);
});

test("reportOn lists only open issues", async () => {
  const jira = fakeJira([existingIssue(1), existingIssue(2, { statusCategory: "done" })]);
  let asked;
  await runSync({ jira, config, fetchQueue: async (ids) => ((asked = ids), { queue: [], resolved: [] }) });
  assert.deepEqual(asked, ["h1"]);
});

test("planSync names what it will do without touching Jira", () => {
  const actions = planSync([item("h1"), item("h3")], [existingIssue(1), existingIssue(2)], {});
  assert.deepEqual(actions.map((a) => a.type), ["create", "close"]);
  assert.match(actions[1].comment, /no longer on the door-check list/);
});

test("description has the crew facts and no phone number", () => {
  const text = JSON.stringify(descriptionFor(item("h1")));
  for (const fact of ["Need level: High", "uses a walker", "Language: es", "2026-01-09T03:30", "3 call attempts"]) {
    assert.ok(text.includes(fact), fact);
  }
  assert.equal(/\+?\d{3}[-\s)]*\d{3}[-\s]*\d{4}/.test(text), false);
  assert.equal(summaryFor(item("h1")), "Door check: h1 Mariposa St");
});

test("the Rovo answer lists matching homes in rank order, at most five", () => {
  const queue = Array.from({ length: 7 }, (_, i) => item(`h${i}`, { rank: i + 1 }));
  queue.push(item("x", { rank: 8, address: "9 Other Ave" }));
  const lines = urgentAnswer(queue, "mariposa").split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[0], /^#1 h0 Mariposa St/);
  assert.match(urgentAnswer(queue, "Nowhere"), /No unreached homes match/);
});

test("a closed incident deletes every door-check issue, open or done, and creates none", async () => {
  const jira = fakeJira([existingIssue(1), existingIssue(2, { statusCategory: "done" })]);
  const result = await runSync({ jira, config, fetchQueue: async () => ({ queue: [item("h3")], resolved: [], incidentClosed: true }) });
  assert.equal(jira.issues.size, 0);
  assert.equal(result.deleted, 2);
  assert.deepEqual(result.failures, []);
});
