import { Suspense } from "@pracht/core";
import { useState } from "preact/hooks";
import { Skeleton } from "./skeleton";

export function CounterButton() {
  const [count, setCount] = useState(0);

  return (
    <button
      type="button"
      class="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      onClick={() => setCount((n) => n + 1)}
    >
      JS counter · clicked {count} times
    </button>
  );
}

/**
 * Client-only counter that suspends so the HTML stream flushes a fallback
 * first, then patches in the interactive button (today via `<preact-island>`).
 */
export function StreamedCounter() {
  return (
    <Suspense fallback={<Skeleton label="JS counter" class="py-2" />}>
   
    </Suspense>
  );
}
