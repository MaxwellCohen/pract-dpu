import type { ComponentChildren } from "preact";
import { readSleep } from "../lib/request-flags";

type SlowPanelProps = {
  label: string;
  delayMs: number;
  tone?: "sky" | "emerald" | "amber" | "rose" | "violet";
  children?: ComponentChildren;
};

const tones = {
  sky: "border-sky-300 bg-sky-50 text-sky-950",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-950",
  amber: "border-amber-300 bg-amber-50 text-amber-950",
  rose: "border-rose-300 bg-rose-50 text-rose-950",
  violet: "border-violet-300 bg-violet-50 text-violet-950",
} as const;

/**
 * Suspends for `delayMs` then paints a toned panel. `readSleep` → `use(promise)`
 * (React-style) so Suspense can stream the fallback first, then resolved UI
 * (today via `<preact-island>`; later via DPU).
 */
export function SlowPanel({
  label,
  delayMs,
  tone = "sky",
  children,
}: SlowPanelProps) {
  readSleep(`slow-panel:${label}:${delayMs}`, delayMs);

  return (
    <section class={`rounded-md border px-4 py-6 ${tones[tone]}`}>
      <h2 class="text-lg font-bold tracking-tight">{label}</h2>
      <p class="mt-1 text-sm opacity-80">Resolved after {delayMs}ms</p>
      {children ? <div class="mt-3">{children}</div> : null}
    </section>
  );
}
