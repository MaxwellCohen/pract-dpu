//#region src/error-overlay.d.ts
/**
 * Self-contained error overlay for pracht dev mode.
 *
 * Returns a standalone HTML document with inline styles and scripts.
 * Not a Preact component — must render even when Preact itself fails.
 *
 * Dev-only: the overlay is served exclusively by the vite-plugin dev SSR
 * middleware, so it can rely on Vite's built-in `/__open-in-editor`
 * endpoint (launch-editor middleware) to make stack frames clickable.
 */
interface ErrorOverlayOptions {
  message: string;
  stack?: string;
  routeId?: string;
  file?: string;
  /**
   * Request phase the failure came from (`loader`, `render`, `middleware`, …),
   * shown as a meta row. A loader failure and a render failure look identical
   * in a stack trace once JSX is compiled away.
   */
  phase?: string;
  /** Loader module path, when the route loads from a separate server file. */
  loaderFile?: string;
  /** Shell module path wrapping the failing route. */
  shellFile?: string;
  /**
   * Project root (Vite's `server.config.root`). Used to resolve
   * dev-server URL paths such as `/src/routes/home.tsx` to filesystem
   * paths for the open-in-editor links.
   */
  root?: string;
  /** Vite deploy base used to reach the dev server's editor endpoint. */
  base?: string;
}
declare function stripAnsi(value: string): string;
interface StackFrame {
  /** The original stack line, unmodified. */
  raw: string;
  /** The exact `file:line:column` substring inside `raw`, when present. */
  locationText?: string;
  /** Normalized filesystem path suitable for `/__open-in-editor`. */
  file?: string;
  line?: number;
  column?: number;
  /** False for node_modules, `node:` internals, and Vite-internal frames. */
  isApp: boolean;
}
/**
 * Parse a V8-style stack trace into frames. Non-frame lines (the message
 * line, empty lines) are preserved as non-app frames without a location.
 */
declare function parseStackFrames(stack: string, options?: {
  root?: string;
}): StackFrame[];
/**
 * Normalize a stack-frame path to a filesystem path that Vite's
 * `/__open-in-editor` endpoint can open. Handles `file://` URLs,
 * `http://` dev-server URLs, `/@fs/` prefixes, Vite query suffixes
 * (`?t=123`, `?pracht-client`), and root-relative dev URLs like
 * `/src/routes/home.tsx` (joined onto `root` when provided).
 */
declare function normalizeStackFile(rawPath: string, root?: string): string | undefined;
declare function buildErrorOverlayHtml(options: ErrorOverlayOptions): string;
//#endregion
export { ErrorOverlayOptions, StackFrame, buildErrorOverlayHtml, normalizeStackFile, parseStackFrames, stripAnsi };