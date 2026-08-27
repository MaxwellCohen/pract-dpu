import { ComponentChildren, VNode } from "preact";

//#region src/script.d.ts
/**
 * First-party `<Script>` component with loading strategies — the framework's
 * next/script analogue for third-party scripts.
 *
 * Strategies:
 * - `"beforeHydration"` — the script is collected during the server render and
 *   emitted into the document `<head>` alongside `head()` scripts, so it runs
 *   before the client runtime hydrates. This strategy only applies to
 *   server-rendered documents: on a client-side navigation the document head
 *   is not re-rendered, so the script is injected immediately instead (with a
 *   dev warning).
 * - `"afterHydration"` (default) — injected once the full hydration pass,
 *   including suspended boundaries, has completed.
 * - `"idle"` — injected in `requestIdleCallback` (setTimeout fallback).
 * - `"visible"` — a zero-size placeholder is rendered in place and the script
 *   is injected when the placeholder enters the viewport
 *   (IntersectionObserver; immediate fallback where unsupported).
 *
 * A script identified by `id`, `src`, or its inline content is never injected
 * twice — across re-renders, client navigations, and server-emitted
 * `beforeHydration` tags already present in the document.
 *
 * On `hydration: "none"` routes no client JavaScript ships, so only
 * `"beforeHydration"` (and `head()` scripts) can run; client strategies warn
 * in dev and render nothing.
 */
declare const SCRIPT_STRATEGIES: readonly ["beforeHydration", "afterHydration", "idle", "visible"];
type ScriptStrategy = (typeof SCRIPT_STRATEGIES)[number];
interface ScriptProps {
  /** Loading strategy. Defaults to `"afterHydration"`. */
  strategy?: ScriptStrategy;
  /** External script URL. Mutually exclusive with inline children. */
  src?: string;
  /** Stable identifier used for deduplication and as the DOM `id`. */
  id?: string;
  async?: boolean;
  defer?: boolean;
  type?: string;
  nonce?: string;
  integrity?: string;
  crossorigin?: string;
  referrerpolicy?: string;
  /**
   * Client-only: fired when an external (`src`) script finishes loading via
   * one of the client strategies. Never serialized into SSR HTML, and not
   * fired for `beforeHydration` scripts the server already emitted.
   */
  onLoad?: (event: Event) => void;
  /** Client-only: fired when an external (`src`) script fails to load. */
  onError?: (event: Event) => void;
  /**
   * Inline script source, as an alternative to `src`. Must be a string (or an
   * array of strings) — JSX children throw a descriptive error.
   */
  children?: ComponentChildren;
}
declare function Script(props: ScriptProps): VNode | null;
//#endregion
export { Script, ScriptProps, ScriptStrategy };