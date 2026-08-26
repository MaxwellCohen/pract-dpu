import { Suspense } from "@pracht/core";
import { readSleep } from "../lib/request-flags";

function StreamProbeFallback() {
  return (
    <div class="animate-pulse rounded-md border border-dashed border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      Streaming… waiting for the Suspense boundary to resolve. With JavaScript
      on, Preact’s <code class="text-xs">&lt;preact-island&gt;</code> patch
      should replace this fallback.
    </div>
  );
}

function StreamProbeResult() {
  readSleep("stream-probe", 1000);
  return (
    <div class="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-950">
      <span class="font-bold">Stream resolved</span> — this message arrived in a
      later HTML chunk and replaced the loading fallback.
    </div>
  );
}

/**
 * Live probe for Preact Suspense HTML streaming. The shell flushes the
 * fallback first; a later chunk streams the resolved UI via stock
 * preact-render-to-string markers (`<!--$s:id-->` / `<preact-island>`).
 */
export function DpuSupportBanner() {
  return (
    <Suspense fallback={<StreamProbeFallback />}>
      <StreamProbeResult />
    </Suspense>
  );
}
