import { Suspense } from "@pracht/core";
import { ExampleShell } from "../components/example-shell";
import { readSleep } from "../lib/request-flags";

export function head() {
  return { title: "Grid · Suspense streaming" };
}

function GridCellFallback() {
  return <div class="animate-pulse text-zinc-300">·</div>;
}

function GridCell({ index, delayMs }: { index: number; delayMs: number }) {
  readSleep(`grid-cell:${index}`, delayMs);
  return <div>{index}</div>;
}

export function Component() {
  return (
    <ExampleShell
      title="Grid"
      description="A stress grid of 100 Suspense cells. Fallbacks flush first; each cell streams in as its delay resolves ((i % 7) × 100ms)."
    >
      <div class="grid grid-cols-10 gap-4">
        {Array.from({ length: 100 }, (_, i) => (
          <Suspense key={i} fallback={<GridCellFallback />}>
            <GridCell index={i} delayMs={(i % 7) * 100} />
          </Suspense>
        ))}
      </div>
    </ExampleShell>
  );
}
