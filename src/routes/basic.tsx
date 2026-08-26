import { Suspense } from "@pracht/core";
import { ExampleShell } from "../components/example-shell";
import { Skeleton } from "../components/skeleton";
import { SlowPanel } from "../components/slow-panel";

export function head() {
  return { title: "Basic boundary · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Basic boundary"
      description="The heading above is in the shell and should appear immediately. The panel below is wrapped in Suspense and streams after a 1.5s delay."
    >
      <Suspense fallback={<Skeleton label="profile" />}>
        <SlowPanel label="Profile" delayMs={1500} tone="sky" />
      </Suspense>
    </ExampleShell>
  );
}
