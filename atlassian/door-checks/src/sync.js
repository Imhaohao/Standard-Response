import { commentBody, createFields, descriptionFor, planSync, propertyFor, summaryFor } from "./issues.js";

const appliers = {
  create: (jira, action, config) => jira.createIssue(createFields(action.item, config), propertyFor(action.item)),
  update: async (jira, action) => {
    await jira.updateIssue(action.key, { summary: summaryFor(action.item), description: descriptionFor(action.item) }, propertyFor(action.item));
    await jira.addComment(action.key, commentBody(action.comment));
  },
  reopen: async (jira, action) => {
    await jira.transition(action.key, "new");
    await appliers.update(jira, action);
  },
  close: async (jira, action) => {
    await jira.addComment(action.key, commentBody(action.comment));
    await jira.transition(action.key, "done");
  },
};

async function applyAll(jira, actions, config) {
  const failures = [];
  for (const action of actions) {
    try {
      await appliers[action.type](jira, action, config);
    } catch (error) {
      failures.push({ type: action.type, key: action.key, message: String(error?.message ?? error) });
    }
  }
  return failures;
}

// jira: the small client in jira.js (or a fake in tests). fetchQueue(reportOn) asks Convex.
// One failed issue never stops the rest, and the next run retries it.
export async function runSync({ jira, fetchQueue, config }) {
  const existing = await jira.findDoorCheckIssues(config.projectKey);
  const openIds = existing.filter((issue) => issue.statusCategory !== "done").map((issue) => issue.householdId);
  const { queue, resolved } = await fetchQueue(openIds);
  const resolvedById = Object.fromEntries(resolved.map((home) => [home.householdId, home.status]));
  const actions = planSync(queue, existing, resolvedById);
  const failures = await applyAll(jira, actions, config);
  return { queued: queue.length, actions: actions.length, failures };
}
