import { Suspense } from "@pracht/core";
import { ExampleShell } from "../components/example-shell";
import { Skeleton } from "../components/skeleton";
import { SlowPanel } from "../components/slow-panel";

export function head() {
  return { title: "Nested boundaries · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Nested boundaries"
      description="The outer panel streams first (1s). Once it appears, the inner Suspense keeps showing its fallback until the nested content resolves (another 1.5s)."
    >
      <Suspense fallback={<Skeleton label="account shell" />}>
        <SlowPanel label="Account shell" delayMs={1000} tone="violet">
          <Suspense fallback={<Skeleton label="nested details" />}>
            <SlowPanel label="Nested details" delayMs={1500} tone="sky" />
          </Suspense>
        </SlowPanel>
      </Suspense>
    </ExampleShell>
  );
}
