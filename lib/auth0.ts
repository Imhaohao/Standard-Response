import { Auth0Client, filterDefaultIdTokenClaims } from "@auth0/nextjs-auth0/server";
import { ROLES_CLAIM } from "./access";

// Setting AUTH0_DOMAIN switches dispatcher login on. Without it every screen stays open, as before.
export const auth0 = process.env.AUTH0_DOMAIN
  ? new Auth0Client({
      authorizationParameters: { scope: "openid profile email" },
      // The SDK keeps only profile claims by default; roles and how the user signed in decide access.
      async beforeSessionSaved(session) {
        const { amr, [ROLES_CLAIM]: roles } = session.user;
        return { ...session, user: { ...filterDefaultIdTokenClaims(session.user), amr, [ROLES_CLAIM]: roles } };
      },
    })
  : null;
