export const NO_JS_COOKIE = "no-js";
export const NO_JS_PATH = "/api/no-js";

/** Blocks scripts so the page runs as HTML-only (no client JS). */
export const CSP_DISABLE_JS = "script-src 'none'";

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]!) : null;
}

export function isNoJsEnabled(request: Request): boolean {
  return readCookie(request.headers.get("cookie"), NO_JS_COOKIE) === "1";
}

export function isSafeRedirect(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//")
  );
}
