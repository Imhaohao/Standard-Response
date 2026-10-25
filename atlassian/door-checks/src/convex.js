import { fetch } from "@forge/api";

export function convexClient({ siteUrl, secret }) {
  return async function postDoorChecks(body) {
    const response = await fetch(`${siteUrl.replace(/\/$/, "")}/agent/door-checks`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Convex answered ${response.status}`);
    return response.json();
  };
}
