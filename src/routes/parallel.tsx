import { Suspense } from "@pracht/core";
import { ExampleShell } from "../components/example-shell";
import { Skeleton } from "../components/skeleton";
import { SlowPanel } from "../components/slow-panel";

export function head() {
  return { title: "Parallel boundaries · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Parallel boundaries"
      description="Three sibling Suspense boundaries start together. Watch them resolve at 800ms, 1600ms, and 2400ms without blocking each other."
    >
      <div class="grid gap-4 sm:grid-cols-3">
        <Suspense fallback={<Skeleton label="stats" />}>
          <SlowPanel label="Stats" delayMs={800} tone="emerald" />
        </Suspense>
        <Suspense fallback={<Skeleton label="activity" />}>
          <SlowPanel label="Activity" delayMs={1600} tone="amber" />
        </Suspense>
        <Suspense fallback={<Skeleton label="billing" />}>
          <SlowPanel label="Billing" delayMs={2400} tone="rose" />
        </Suspense>
      </div>
    </ExampleShell>
  );
}
