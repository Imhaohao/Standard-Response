import { convexClient } from "./convex.js";
import { jira } from "./jira.js";
import { runSync } from "./sync.js";
import { urgentAnswer } from "./urgent.js";

const MAX_QUEUE = 200;

function settings() {
  const { CONVEX_SITE_URL, ATLASSIAN_APP_SECRET, JIRA_PROJECT_KEY, JIRA_ISSUE_TYPE } = process.env;
  if (!CONVEX_SITE_URL || !ATLASSIAN_APP_SECRET || !JIRA_PROJECT_KEY) {
    throw new Error("Set CONVEX_SITE_URL, ATLASSIAN_APP_SECRET and JIRA_PROJECT_KEY with forge variables set.");
  }
  const post = convexClient({ siteUrl: CONVEX_SITE_URL, secret: ATLASSIAN_APP_SECRET });
  return { post, config: { projectKey: JIRA_PROJECT_KEY, issueType: JIRA_ISSUE_TYPE || "Task" } };
}

export async function syncDoorChecks() {
  const { post, config } = settings();
  const result = await runSync({ jira, config, fetchQueue: (reportOn) => post({ limit: MAX_QUEUE, reportOn }) });
  console.log(JSON.stringify(result));
  return result;
}

export async function urgentDoorChecks(payload) {
  const { post } = settings();
  const { queue } = await post({ limit: MAX_QUEUE });
  return urgentAnswer(queue, String(payload?.street ?? ""));
}
