import { Suspense } from "@pracht/core";
import { readSleep } from "../lib/request-flags";

function StreamProbeFallback() {
  return (
    <div class="animate-pulse rounded-md border border-dashed border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950">
      Streaming… waiting for the Suspense boundary to resolve. Today a{" "}
      <code class="text-xs">&lt;preact-island&gt;</code> patch replaces this;
      DPU experiments target that swap.
    </div>
  );
}

function StreamProbeResult() {
  readSleep("stream-probe", 1000);
  return (
    <div class="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-950">
      <span class="font-bold">Stream resolved</span> — later HTML chunk replaced
      the loading fallback.
    </div>
  );
}

/** Live probe: shell fallback first, then streamed resolved UI. */
export function DpuSupportBanner() {
  return (
    <Suspense fallback={<StreamProbeFallback />}>
      <StreamProbeResult />
    </Suspense>
  );
}
