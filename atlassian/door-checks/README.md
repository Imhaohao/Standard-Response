# Door checks in Jira

A Forge app that turns the door-check queue (homes nobody reached, most urgent first) into Jira work items for field crews.

Every 5 minutes it asks Convex for the queue (`POST /agent/door-checks`, bearer secret) and then:

| Queue says | Jira gets |
| --- | --- |
| New home | One issue, "Door check: <address>", labelled `door-check`, with rank, need level, mobility and assistance, language, last call attempt and why it is listed. |
| Same home, status changed (more attempts, new flag) | The description is refreshed and a comment says what changed. |
| Home reached, or removed | A comment saying where it stands now, then the issue moves to a Done status. |
| Home came back after being closed | The issue reopens with a comment. |

An issue the crew closed by hand stays closed until the system status changes.

The household id lives in an issue property (`doorCheck`), written in the same call that creates the issue, so a rerun never duplicates. No phone number or resident name ever leaves Convex.

**Privacy.** The issues hold home addresses of people who may need rescue. Make the Jira project private to the field crews and the incident commander. When the incident is closed in the system, the next sync deletes every door-check issue (the app user needs the "Delete issues" project permission). Medical equipment (oxygen, dialysis) is included because a crew needs it at the door.

The optional Rovo agent "Door check helper" answers "Which door checks are most urgent near Mariposa St?" from the same route. It needs Rovo on the site.

## Deploy

Needs Node 22 or 24 and a Jira Cloud site you administer.

```bash
npm install -g @forge/cli
cd atlassian/door-checks && npm install
forge login
forge register                    # writes app.id into manifest.yml
forge variables set --encrypt ATLASSIAN_APP_SECRET <long random string>
forge variables set CONVEX_SITE_URL https://<deployment>.convex.site
forge variables set JIRA_PROJECT_KEY DOOR
forge variables set JIRA_ISSUE_TYPE Task        # optional, defaults to Task
forge deploy
forge install                     # pick Jira and your site
```

Set the same secret on the Convex side, then redeploy Convex:

```bash
npx convex env set ATLASSIAN_APP_SECRET <the same string>
```

Variables only take effect after `forge deploy`. Use `--environment production` on each command for a production install. If the project's Done status has no transition from "To Do", add one in the Jira workflow, because the app moves issues by status category.

Check it with `forge logs`, or call the route by hand: `curl -X POST -H "Authorization: Bearer $SECRET" $CONVEX_SITE_URL/agent/door-checks` (no secret returns 401).

## Test

```bash
cd atlassian/door-checks && npm test        # Forge side, node:test, fake Jira
npx vitest run tests/workflow/atlassianDoorChecks.test.ts --environment edge-runtime   # repo root, Convex route
```
