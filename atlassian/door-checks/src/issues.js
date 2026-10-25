export const DOOR_CHECK_LABEL = "door-check";
export const PROPERTY_KEY = "doorCheck";

const LEVEL_WORDS = { high: "High", medium: "Medium", lower: "Lower", unknown: "Not known (no needs on file)" };

export const summaryFor = (item) => `Door check: ${item.address}`;

export function fingerprintFor(item) {
  return `${item.attempts}|${item.statusNote}`;
}

export function propertyFor(item) {
  return { householdId: item.householdId, fingerprint: fingerprintFor(item), rank: item.rank };
}

const paragraph = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });

export function lastAttemptText(lastAttemptAt) {
  return lastAttemptAt === null ? "no call attempt recorded" : new Date(lastAttemptAt).toISOString();
}

export function descriptionFor(item) {
  const lines = [
    `Priority rank: ${item.rank} (1 is knocked on first)`,
    `Need level: ${LEVEL_WORDS[item.needLevel]}`,
    `Mobility and assistance: ${item.needSummary}`,
    `Language: ${item.language}`,
    `Last call attempt: ${lastAttemptText(item.lastAttemptAt)}`,
    `Why it is on the list: ${item.reason}`,
  ];
  if (item.lat !== null && item.lng !== null) lines.push(`Location: ${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`);
  return { version: 1, type: "doc", content: lines.map(paragraph) };
}

export const commentBody = (text) => ({ version: 1, type: "doc", content: [paragraph(text)] });

export function createFields(item, config) {
  return {
    project: { key: config.projectKey },
    issuetype: { name: config.issueType },
    summary: summaryFor(item),
    description: descriptionFor(item),
    labels: [DOOR_CHECK_LABEL],
  };
}

const isDone = (issue) => issue.statusCategory === "done";

function actionsForQueuedHome(item, issue) {
  if (!issue) return [{ type: "create", item }];
  if (issue.fingerprint === fingerprintFor(item)) return [];
  if (isDone(issue)) {
    return [{ type: "reopen", key: issue.key, item, comment: `Reopened: this home is back on the door-check list. ${item.statusNote}.` }];
  }
  return [{ type: "update", key: issue.key, item, comment: `Status changed in the system: ${item.statusNote}.` }];
}

// Compares the queue with the issues already in Jira and lists what to do. No network here.
// existing: [{ key, householdId, fingerprint, statusCategory }]
// resolvedById: { [householdId]: status text } for homes that left the queue.
export function planSync(queue, existing, resolvedById) {
  const byHousehold = new Map(existing.map((issue) => [issue.householdId, issue]));
  const queued = new Set(queue.map((item) => item.householdId));
  const actions = queue.flatMap((item) => actionsForQueuedHome(item, byHousehold.get(item.householdId)));
  for (const issue of existing) {
    if (queued.has(issue.householdId) || isDone(issue)) continue;
    const status = resolvedById[issue.householdId] ?? "no longer on the door-check list";
    actions.push({ type: "close", key: issue.key, comment: `Closed: this home is ${status}.` });
  }
  return actions;
}
