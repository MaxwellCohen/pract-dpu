import { NO_JS_PATH } from "../lib/no-js";
import { getRequestFlags } from "../lib/request-flags";

/**
 * Plain HTML form — works with JS disabled. Sets a cookie that middleware
 * turns into `Content-Security-Policy: script-src 'none'`.
 */
export function NoJsToggle() {
  const { noJs: enabled, path } = getRequestFlags();

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
