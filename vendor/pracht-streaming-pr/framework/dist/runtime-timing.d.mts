//#region src/runtime-timing.d.ts
/**
 * Per-request phase timing for dev tooling.
 *
 * The runtime only records durations when a collector object is passed via
 * `HandlePrachtRequestOptions.timings` — the dev server passes one, production
 * adapters never do, so production requests skip all timing work.
 */
interface PrachtPhaseTimings {
  /** Milliseconds spent in the middleware chain, excluding loader and render. */
  mw?: number;
  /** Milliseconds spent awaiting the route loader. */
  loader?: number;
  /** Milliseconds spent resolving modules and rendering the response, excluding the loader. */
  render?: number;
}
/**
 * Format collected phase timings as a standards-compliant `Server-Timing`
 * header value, e.g. `mw;dur=1.2, loader;dur=14.8, render;dur=3.1`.
 * Returns an empty string when nothing was recorded.
 */
declare function formatServerTimingHeader(timings: PrachtPhaseTimings): string;
//#endregion
export { PrachtPhaseTimings, formatServerTimingHeader };