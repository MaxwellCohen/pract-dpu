import { Suspense } from "@pracht/core";
import { ExampleShell } from "../components/example-shell";
import { Skeleton } from "../components/skeleton";
import { SlowPanel } from "../components/slow-panel";

export function head() {
  return { title: "Out of order · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Out-of-order reveal"
      description="The first boundary is intentionally slow (2.5s). The second is fast (600ms). The fast panel should stream in before the slow one finishes — HTML completion order follows readiness, not source order."
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <Suspense fallback={<Skeleton label="slow first" />}>
          <SlowPanel label="Declared first (slow)" delayMs={2500} tone="rose" />
        </Suspense>
        <Suspense fallback={<Skeleton label="fast second" />}>
          <SlowPanel
            label="Declared second (fast)"
            delayMs={600}
            tone="emerald"
          />
        </Suspense>
      </div>
    </ExampleShell>
  );
}
