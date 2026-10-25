// The judge's phone remembers its status link, so a judge who opens /join again after the sign-in
// expired can still get back to their house. The URL is the real key; this is only a convenience,
// and storage can be missing or blocked (private windows), so every access is guarded.

const STORAGE_KEY = "standard-response:house-status";

export const statusPath = (token: string) => `/you/${token}`;

export function rememberStatusToken(token: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, token);
  } catch {}
}

export function rememberedStatusToken() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function forgetStatusToken(token: string) {
  try {
    if (window.localStorage.getItem(STORAGE_KEY) === token) window.localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
