import { NextRequest, NextResponse } from "next/server";
import { loginUrl, mayOpen, rolesFor } from "./lib/access";
import { auth0 } from "./lib/auth0";

// Auth0 owns /auth/*. Every other request refreshes the session, and a screen that shows the
// at-risk list sends a visitor without the right role to log in or to /no-access.
export async function proxy(request: NextRequest) {
  if (!auth0) return NextResponse.next();
  const response = await auth0.middleware(request);
  const path = request.nextUrl.pathname;
  if (path.startsWith("/auth/") || !rolesFor(path)) return response;
  const session = await auth0.getSession(request);
  if (!session) return NextResponse.redirect(new URL(loginUrl(path), request.url));
  if (!mayOpen(session.user, path)) return NextResponse.redirect(new URL("/no-access", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|sitemap.xml|robots.txt|data/|.*\\.(?:png|jpg|svg|json|bin|glb|webp)$).*)"],
};
