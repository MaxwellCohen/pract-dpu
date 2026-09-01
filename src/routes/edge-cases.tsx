import { Suspense } from "@pracht/core";
import type { ComponentChildren } from "preact";
import { CaseCompare } from "../components/case-compare";
import { ExampleShell } from "../components/example-shell";
import { readSleep } from "../lib/request-flags";

const POPCORN_KERNELS = [
  { id: 0, delayMs: 420 },
  { id: 1, delayMs: 1680 },
  { id: 2, delayMs: 780 },
  { id: 3, delayMs: 2100 },
  { id: 4, delayMs: 1100 },
  { id: 5, delayMs: 540 },
  { id: 6, delayMs: 1900 },
  { id: 7, delayMs: 1320 },
  { id: 8, delayMs: 2260 },
  { id: 9, delayMs: 860 },
  { id: 10, delayMs: 1480 },
  { id: 11, delayMs: 640 },
  { id: 12, delayMs: 1980 },
  { id: 13, delayMs: 980 },
  { id: 14, delayMs: 1200 },
  { id: 15, delayMs: 1540 },
] as const;

function KernelFallback() {
  return <div class="h-10 animate-pulse rounded bg-zinc-200" />;
}

function KernelDone({ id }: { id: number }) {
  return (
    <div class="flex h-10 items-center justify-center rounded bg-emerald-200 text-xs font-bold text-emerald-950">
      {id}
    </div>
  );
}

function DelayedKernel({ id, delayMs }: { id: number; delayMs: number }) {
  readSleep(`edge-kernel:${id}`, delayMs);
  return <KernelDone id={id} />;
}

function DelayedHtml() {
  readSleep("edge-html", 600);
  return <p>Done — declarative DPU worked</p>;
}

function DelayedCircle() {
  readSleep("edge-svg", 800);
  return (
    <circle
      cx="80"
      cy="55"
      r="24"
      fill="tomato"
      stroke="white"
      stroke-width="2"
    />
  );
}

function DelayedMath() {
  readSleep("edge-math", 800);
  return (
    <>
      <mi>x</mi>
      <mo>+</mo>
      <mn>1</mn>
    </>
  );
}

function DelayedStyled() {
  readSleep("edge-style", 900);
  return (
    <>
      <style data-precedence="demo-stream">
        {`.dpu-edge-style { color: tomato; font-weight: 700; }`}
      </style>
      <p class="dpu-edge-style">Styled hello</p>
    </>
  );
}

function SvgStage({ children }: { children: ComponentChildren }) {
  return (
    <div class="relative h-[100px] w-[160px] overflow-hidden rounded-lg border-2 border-dashed border-zinc-300 text-zinc-700">
      <svg
        width="160"
        height="100"
        viewBox="0 0 160 100"
        class="block h-full w-full"
      >
        {children}
      </svg>
    </div>
  );
}

export function head() {
  return { title: "Edge cases · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Edge cases"
      description="Popcorning plus the HTML, SVG, MathML, and style completions that DPU struggles with. Left column is the live stream; right column is the settled target."
    >
      <CaseCompare
        title="Popcorning"
        why="Sixteen sibling boundaries with staggered delays. Completions should arrive independently — kernels pop in out of source order, not as one swap."
        expected="All 16 cells filled, labeled 0–15. They appear one-by-one as each delay resolves."
        badge="warn"
        badgeLabel="Out of order"
        streamed={
          <div class="grid grid-cols-4 gap-1.5">
            {POPCORN_KERNELS.map((kernel) => (
              <Suspense key={kernel.id} fallback={<KernelFallback />}>
                <DelayedKernel id={kernel.id} delayMs={kernel.delayMs} />
              </Suspense>
            ))}
          </div>
        }
        result={
          <div class="grid grid-cols-4 gap-1.5">
            {POPCORN_KERNELS.map((kernel) => (
              <KernelDone key={kernel.id} id={kernel.id} />
            ))}
          </div>
        }
      />

      <CaseCompare
        title="HTML — DPU works"
        why="A pending HTML shell, then a completion that swaps fallback for template content. This is the baseline that should succeed."
        expected='Fallback removed. Visible text is “Done — declarative DPU worked”.'
        badge="ok"
        badgeLabel="Should work"
        streamed={
          <Suspense fallback={<p>Loading…</p>}>
            <DelayedHtml />
          </Suspense>
        }
        result={<p>Done — declarative DPU worked</p>}
      />

      <CaseCompare
        title="SVG — namespace"
        why="The boundary sits inside <svg>. Declarative <template for> is HTML-namespaced, so a revealed <circle> may not be an SVGElement and may not paint."
        expected="A tomato circle paints in the dashed frame (real SVG circle, svg namespace)."
        badge="warn"
        badgeLabel="May fail"
        streamed={
          <SvgStage>
            <Suspense
              fallback={
                <text x="8" y="20" font-size="12">
                  Loading…
                </text>
              }
            >
              <DelayedCircle />
            </Suspense>
          </SvgStage>
        }
        result={
          <SvgStage>
            <circle
              cx="80"
              cy="55"
              r="24"
              fill="tomato"
              stroke="white"
              stroke-width="2"
            />
          </SvgStage>
        }
      />

      <CaseCompare
        title="MathML — namespace"
        why="Same insertion issue: template content is HTML, so <mi>/<mo>/<mn> may lose the MathML namespace when placed into <math>."
        expected="The formula renders as x + 1 using MathML, not as unmatched HTML text."
        badge="warn"
        badgeLabel="May fail"
        streamed={
          <math display="block">
            <Suspense fallback={<mtext>Loading…</mtext>}>
              <DelayedMath />
            </Suspense>
          </math>
        }
        result={
          <math display="block">
            <mi>x</mi>
            <mo>+</mo>
            <mn>1</mn>
          </math>
        }
      />

      <CaseCompare
        title="Styles — hoist"
        why="Declarative completion only moves nodes. It does not run completeBoundaryWithStyles, so <style> may stay inline instead of hoisting to <head>."
        expected="“Styled hello” is tomato and bold. Ideally the <style> is in <head>, not left in the boundary."
        badge="warn"
        badgeLabel="May fail"
        streamed={
          <Suspense fallback={<p>Loading…</p>}>
            <DelayedStyled />
          </Suspense>
        }
        result={<p class="font-bold text-[tomato]">Styled hello</p>}
      />
    </ExampleShell>
  );
}
