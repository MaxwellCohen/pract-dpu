import type { ComponentChildren } from "preact";

type CaseCompareProps = {
  title: string;
  why: string;
  expected: string;
  badge: "ok" | "warn";
  badgeLabel: string;
  streamed: ComponentChildren;
  result: ComponentChildren;
};

export function CaseCompare({
  title,
  why,
  expected,
  badge,
  badgeLabel,
  streamed,
  result,
}: CaseCompareProps) {
  return (
    <section class="rounded-xl border border-zinc-200 bg-white p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-lg font-bold tracking-tight">{title}</h2>
          <p class="mt-1 text-sm text-zinc-600">{why}</p>
        </div>
        <span
          class={`rounded-full px-2.5 py-0.5 text-[0.7rem] font-bold tracking-wide uppercase ${
            badge === "ok"
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {badgeLabel}
        </span>
      </div>
      <p class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
        <span class="font-bold">Expected: </span>
        {expected}
      </p>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <figure class="min-w-0">
          <figcaption class="mb-1.5 text-xs font-semibold tracking-[0.12em] text-zinc-500 uppercase">
            Streamed
          </figcaption>
          <div class="min-h-14 overflow-auto rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
            {streamed}
          </div>
        </figure>
        <figure class="min-w-0">
          <figcaption class="mb-1.5 text-xs font-semibold tracking-[0.12em] text-zinc-500 uppercase">
            Expected result
          </figcaption>
          <div class="min-h-14 overflow-auto rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3">
            {result}
          </div>
        </figure>
      </div>
    </section>
  );
}
