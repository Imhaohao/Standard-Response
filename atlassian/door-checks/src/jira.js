import api, { route } from "@forge/api";
import { DOOR_CHECK_LABEL, PROPERTY_KEY } from "./issues.js";

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

const send = (path, method, body) =>
  api.asApp().requestJira(path, { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });

async function call(request, expectedStatuses) {
  const response = await request;
  if (!expectedStatuses.includes(response.status)) throw new Error(`Jira answered ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json().catch(() => null);
}

function toExisting(issue) {
  const property = issue.properties?.[PROPERTY_KEY];
  if (!property?.householdId) return null;
  return {
    key: issue.key,
    householdId: property.householdId,
    fingerprint: property.fingerprint,
    statusCategory: issue.fields.status.statusCategory.key,
  };
}

async function findDoorCheckIssues(projectKey) {
  const found = [];
  let nextPageToken;
  do {
    const page = await call(
      send(route`/rest/api/3/search/jql`, "POST", {
        jql: `project = "${projectKey}" AND labels = "${DOOR_CHECK_LABEL}"`,
        fields: ["status"],
        properties: [PROPERTY_KEY],
        maxResults: 100,
        nextPageToken,
      }),
      [200],
    );
    found.push(...page.issues.map(toExisting).filter(Boolean));
    nextPageToken = page.nextPageToken;
  } while (nextPageToken);
  return found;
}

// The household id goes in with the create call, so a half-made issue never exists without it.
async function createIssue(fields, property) {
  const created = await call(send(route`/rest/api/3/issue`, "POST", { fields, properties: [{ key: PROPERTY_KEY, value: property }] }), [201]);
  return created.key;
}

async function updateIssue(key, fields, property) {
  await call(send(route`/rest/api/3/issue/${key}`, "PUT", { fields }), [204]);
  await call(send(route`/rest/api/3/issue/${key}/properties/${PROPERTY_KEY}`, "PUT", property), [200, 201]);
}

const addComment = (key, body) => call(send(route`/rest/api/3/issue/${key}/comment`, "POST", { body }), [201]);

async function transition(key, targetCategory) {
  const { transitions } = await call(send(route`/rest/api/3/issue/${key}/transitions`, "GET"), [200]);
  const match = transitions.find((candidate) => candidate.to.statusCategory.key === targetCategory);
  if (!match) throw new Error(`No transition to a ${targetCategory} status for ${key}`);
  await call(send(route`/rest/api/3/issue/${key}/transitions`, "POST", { transition: { id: match.id } }), [204]);
}

const deleteIssue = (key) => call(send(route`/rest/api/3/issue/${key}`, "DELETE"), [204]);

export const jira = { findDoorCheckIssues, createIssue, updateIssue, addComment, transition, deleteIssue };
