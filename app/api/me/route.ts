import { connection } from "next/server";
import { rolesOf, steppedUp } from "@/lib/access";
import { auth0 } from "@/lib/auth0";

export type Account =
  | { enabled: false }
  | { enabled: true; signedIn: false }
  | { enabled: true; signedIn: true; name: string; roles: string[]; steppedUp: boolean };

// What the screens need to know about whoever is looking: nothing at all while Auth0 is off.
export async function GET() {
  await connection();
  if (!auth0) return Response.json({ enabled: false } satisfies Account);
  const session = await auth0.getSession();
  if (!session) return Response.json({ enabled: true, signedIn: false } satisfies Account);
  const { user } = session;
  return Response.json({
    enabled: true,
    signedIn: true,
    name: String(user.name ?? user.email ?? "Signed in"),
    roles: rolesOf(user),
    steppedUp: steppedUp(user),
  } satisfies Account);
}
