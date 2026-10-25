import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parseSignUp, parseStatusQuery, statusAnswer } from "./agentPayload";
import { parseDoorChecksRequest, parseJsonBody } from "./doorCheckPayload";
import { parseClosures, parsePayload, secretMatches } from "./apifyPayload";

const http = httpRouter();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

// The "California evacuation status" Apify Actor posts zones that went to warning or order.
// The shared secret lives in the Convex env var APIFY_WEBHOOK_SECRET. With no secret set, every request is refused.
const zoneStatus = httpAction(async (ctx, request) => {
  if (!secretMatches(request.headers.get("authorization"), process.env.APIFY_WEBHOOK_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  const payload = parsePayload(await readJson(request));
  if (!payload) return json({ error: "expected { zones: [...] }" }, 400);
  const result = await ctx.runMutation(internal.apify.applyZones, { zones: payload.zones });
  return json({ received: payload.zones.length + payload.ignored, ignored: payload.ignored, ...result });
});

// The same Actor posts full road closures that started or were lifted since its last run, with the same secret.
const roadClosures = httpAction(async (ctx, request) => {
  if (!secretMatches(request.headers.get("authorization"), process.env.APIFY_WEBHOOK_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  const payload = parseClosures(await readJson(request));
  if (!payload) return json({ error: "expected { closures: [...] }" }, 400);
  const result = await ctx.runMutation(internal.apify.applyClosures, { closures: payload.closures });
  return json({ received: payload.closures.length + payload.ignored, ignored: payload.ignored, ...result });
});

// The Fetch.ai agent (fetchai/) signs a household up for the Ready check on someone's behalf. The shared
// secret lives in the Convex env var FETCH_AGENT_SECRET. The answer never includes a household record.
const agentReadySignup = httpAction(async (ctx, request) => {
  if (!secretMatches(request.headers.get("authorization"), process.env.FETCH_AGENT_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  const signUp = parseSignUp(await readJson(request));
  if (!signUp) return json({ error: "expected phone, address, lat, lng and exitPlan" }, 400);
  await ctx.runMutation(internal.agentIntake.readySignUp, signUp);
  return json({ status: "received", address: signUp.address, verified: false });
});

// Whether an evacuation warning is active, optionally for a point. Public facts only.
const agentStatus = httpAction(async (ctx, request) => {
  if (!secretMatches(request.headers.get("authorization"), process.env.FETCH_AGENT_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  const query = parseStatusQuery(await readJson(request));
  if (!query) return json({ error: "expected optional lat and lng" }, 400);
  const status = await ctx.runQuery(internal.agentIntake.warningStatus, { place: query.place });
  return json(statusAnswer(status.warningActive, status.coversPlace, process.env.EVACUATION_LINE_NUMBER));
});

// The Atlassian Forge app (atlassian/door-checks/) turns the door-check queue into Jira issues. The shared
// secret lives in the Convex env var ATLASSIAN_APP_SECRET. The answer holds no names and no phone numbers.
const agentDoorChecks = httpAction(async (ctx, request) => {
  if (!secretMatches(request.headers.get("authorization"), process.env.ATLASSIAN_APP_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  const parsed = parseDoorChecksRequest(parseJsonBody(await request.text()));
  if (!parsed) return json({ error: "expected optional limit and reportOn (household ids)" }, 400);
  return json(await ctx.runQuery(internal.doorChecks.forFieldCrews, parsed));
});

http.route({ path: "/agent/door-checks", method: "POST", handler: agentDoorChecks });
http.route({ path: "/agent/ready-signup", method: "POST", handler: agentReadySignup });
http.route({ path: "/agent/status", method: "POST", handler: agentStatus });
http.route({ path: "/apify/zone-status", method: "POST", handler: zoneStatus });
http.route({ path: "/apify/road-closures", method: "POST", handler: roadClosures });

export default http;
