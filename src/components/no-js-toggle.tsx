import { NO_JS_COOKIE, NO_JS_PATH, readCookie } from "../lib/no-js";
import { getRequestFlags } from "../lib/request-flags";

/**
 * Plain HTML form — works with JS disabled. Sets a cookie that middleware
 * turns into `Content-Security-Policy: script-src 'none'`.
 */
export function NoJsToggle() {
  // Prefer live browser values on the client so hydration matches SSR
  // (module-level request flags are server-middleware-only).
  const flags = getRequestFlags();
  const enabled =
    typeof document !== "undefined"
      ? readCookie(document.cookie, NO_JS_COOKIE) === "1"
      : flags.noJs;
  const path =
    typeof window !== "undefined" ? window.location.pathname || "/" : flags.path;

  return (
    <form
      method="POST"
      action={NO_JS_PATH}
      class="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
    >
      <input type="hidden" name="redirect" value={path} />
      <input type="hidden" name="no-js" value={enabled ? "0" : "1"} />
      <span class="text-zinc-600">
        JS:{" "}
        <span class="font-semibold text-zinc-900">
          {enabled ? "off (CSP)" : "on"}
        </span>
      </span>
      <button
        type="submit"
        class="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white hover:bg-zinc-700"
      >
        {enabled ? "Turn JS on" : "Turn JS off"}
      </button>
    </form>
  );
}
