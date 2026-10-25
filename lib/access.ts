// Who may open which screen once Auth0 is switched on. Proxy and client read the same rules.

export type Role = "dispatcher" | "driver";

// An Auth0 post-login Action copies the user's roles into the ID token under this claim.
export const ROLES_CLAIM = "https://standard-response.app/roles";
export const MFA_ACR = "http://schemas.openid.net/pape/policies/2007/06/multi-factor";

type Claims = Record<string, unknown>;

// The at-risk list (names, addresses, medical needs) shows on these screens, so they need a role.
const SCREEN_ROLES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/dashboard", roles: ["dispatcher"] },
  { prefix: "/map", roles: ["dispatcher"] },
  { prefix: "/system", roles: ["dispatcher"] },
  { prefix: "/phone", roles: ["dispatcher"] },
  { prefix: "/driver", roles: ["dispatcher", "driver"] },
];

export function rolesFor(path: string): Role[] | null {
  return SCREEN_ROLES.find(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`))?.roles ?? null;
}

export function rolesOf(user: Claims): string[] {
  const roles = user[ROLES_CLAIM];
  return Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : [];
}

export function mayOpen(user: Claims, path: string) {
  const needed = rolesFor(path);
  return !needed || rolesOf(user).some((role) => (needed as string[]).includes(role));
}

export const steppedUp = (user: Claims) => Array.isArray(user.amr) && user.amr.includes("mfa");

export const loginUrl = (returnTo: string) => `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;

// Asks Auth0 for a second factor even when the dispatcher already has a session.
export const stepUpUrl = (returnTo: string) => `/auth/login?acr_values=${encodeURIComponent(MFA_ACR)}&returnTo=${encodeURIComponent(returnTo)}`;
