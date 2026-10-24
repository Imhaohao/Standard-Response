import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { parsePayload, secretMatches } from "./apifyPayload";

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

http.route({ path: "/apify/zone-status", method: "POST", handler: zoneStatus });

export default http;
