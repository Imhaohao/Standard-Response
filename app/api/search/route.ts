import { ConvexHttpClient } from "convex/browser";
import { connection } from "next/server";
import { api } from "@/convex/_generated/api";
import { mayOpen } from "@/lib/access";
import { auth0 } from "@/lib/auth0";

// Transcript search returns where people who may need rescue live and what they said, so it is
// answered here on the server for whoever may open the call floor, and never from the browser
// straight to Convex. With Auth0 off the call floor is open, and so is this route.
async function mayUseCallFloor() {
  if (!auth0) return true;
  const session = await auth0.getSession();
  return Boolean(session && mayOpen(session.user, "/dashboard"));
}

function readQuery(body: unknown) {
  if (typeof body !== "object" || body === null) return null;
  const { q, language } = body as Record<string, unknown>;
  if (typeof q !== "string" || q.trim() === "" || q.length > 200) return null;
  return { q, language: typeof language === "string" ? language : undefined };
}

export async function POST(request: Request) {
  await connection();
  if (!(await mayUseCallFloor())) return Response.json({ error: "dispatcher access needed" }, { status: 403 });
  const query = readQuery(await request.json().catch(() => null));
  if (!query) return Response.json({ error: "expected { q }" }, { status: 400 });
  const secret = process.env.SEARCH_SECRET;
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!secret || !url) return Response.json([]);
  const results = await new ConvexHttpClient(url).action(api.elastic.search, { ...query, secret });
  return Response.json(results);
}
