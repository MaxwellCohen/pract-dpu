import type { ComponentChildren } from "preact";
import { getRequestFlags } from "../lib/request-flags";

type ScenarioProps = {
  id: string;
  title: string;
  expected: string;
  children: ComponentChildren;
};

/** Fixture card. `data-scenario` is the hook the Playwright suite targets. */
export function Scenario({ id, title, expected, children }: ScenarioProps) {
  // ?only=a,b renders just those scenarios (server-side; used to isolate failures).
  const only = new URLSearchParams(getRequestFlags().search).get("only");
  if (only && !only.split(",").includes(id)) return null;
  return (
    <section
      data-scenario={id}
      class="rounded-xl border border-zinc-200 bg-white p-4"
    >
      <h2 class="text-lg font-bold tracking-tight">{title}</h2>
      <p class="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
        <span class="font-bold">Expected: </span>
        {expected}
      </p>
      <div
        data-slot="stage"
        class="mt-3 min-h-14 overflow-auto rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3"
      >
        {children}
      </div>
    </section>
  );
}
