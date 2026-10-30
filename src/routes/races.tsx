import { Suspense } from "@pracht/core";
import { useState } from "preact/hooks";
import { ExampleShell } from "../components/example-shell";
import { Scenario } from "../components/scenario";
import { readSleep } from "../lib/request-flags";

// The test suite controls client timing by delaying /assets/*.js; the server
// delays below are fixed so patch arrival is deterministic relative to that.

function Counter({ name }: { name: string }) {
  const [n, setN] = useState(0);
  return (
    <button
      type="button"
      data-testid={`${name}-btn`}
      class="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white"
      onClick={() => setN((v) => v + 1)}
    >
      {name} clicks: <span data-testid={`${name}-count`}>{n}</span>
    </button>
  );
}

function Late({ id, ms, children }: { id: string; ms: number; children: any }) {
  readSleep(`race:${id}`, ms);
  return <>{children}</>;
}

function Fallback({ text }: { text: string }) {
  return <p data-testid="fallback">{text}</p>;
}

export function head() {
  return { title: "Hydration races · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Hydration races"
      description="Patch arrival vs. client hydration. Delay /assets/*.js in the test to push hydration before, during, or after each patch."
    >
      <Scenario
        id="patch-interactive"
        title="Interactive content inside a streamed boundary"
        expected="Counter is present after the patch and increments on click, whether the patch lands before or after hydration."
      >
        <Suspense fallback={<Fallback text="Loading counter…" />}>
          <Late id="patch-interactive" ms={400}>
            <Counter name="patched" />
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="typed-input"
        title="User input in the shell before the boundary resolves"
        expected="Text typed into the input is preserved after the sibling boundary patches in (no re-created input)."
      >
        <input
          data-testid="typed-input"
          class="rounded border border-zinc-300 px-2 py-1"
          placeholder="type here"
        />
        <Suspense fallback={<Fallback text="Loading sibling…" />}>
          <Late id="typed-input" ms={800}>
            <p data-testid="typed-sibling">sibling resolved</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="typed-input-inside"
        title="Input inside the fallback is replaced"
        expected="Fallback input disappears; resolved content shows an empty input. No duplicate inputs remain."
      >
        <Suspense
          fallback={<input data-testid="fb-input" placeholder="fallback input" />}
        >
          <Late id="typed-input-inside" ms={800}>
            <input data-testid="done-input" placeholder="resolved input" />
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="focus-in-shell"
        title="Focus outside the boundary survives a patch"
        expected="A focused input keeps focus and caret when a later boundary patches in."
      >
        <input data-testid="focus-input" class="rounded border px-2 py-1" />
        <Suspense fallback={<Fallback text="Loading…" />}>
          <Late id="focus-in-shell" ms={900}>
            <p data-testid="focus-done">done</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="click-before-hydration"
        title="Click on server HTML before hydration"
        expected="Button exists as inert HTML; once hydrated, clicks increment. Early clicks are not required to replay."
      >
        <Counter name="shell" />
        <Suspense fallback={<Fallback text="Loading…" />}>
          <Late id="click-before-hydration" ms={600}>
            <p data-testid="click-done">done</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="client-wins"
        title="Client render beats a late patch"
        expected="Content rendered by the client is never replaced by a stale server patch; exactly one copy of the content exists."
      >
        <Suspense fallback={<Fallback text="Loading…" />}>
          <Late id="client-wins" ms={1800}>
            <p data-testid="client-wins-content">content</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="adjacent-boundaries"
        title="Adjacent boundaries resolving in the same tick"
        expected="Both boundaries patch; no node from one boundary is removed by the other."
      >
        <Suspense fallback={<Fallback text="A…" />}>
          <Late id="adj-a" ms={500}>
            <p data-testid="adj-a">A</p>
          </Late>
        </Suspense>
        <Suspense fallback={<Fallback text="B…" />}>
          <Late id="adj-b" ms={500}>
            <p data-testid="adj-b">B</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="nested-inner-first"
        title="Nested: inner resolves before outer"
        expected="Final DOM has outer content with inner content once, in order."
      >
        <Suspense fallback={<Fallback text="outer…" />}>
          <Late id="nest-outer" ms={1200}>
            <div data-testid="nest-outer">
              outer
              <Suspense fallback={<Fallback text="inner…" />}>
                <Late id="nest-inner" ms={300}>
                  <p data-testid="nest-inner">inner</p>
                </Late>
              </Suspense>
            </div>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario
        id="many-boundaries"
        title="60 boundaries, random-ish order"
        expected="All 60 cells filled exactly once; none duplicated or dropped."
      >
        <div class="grid grid-cols-10 gap-1" data-testid="many-grid">
          {Array.from({ length: 60 }, (_, i) => (
            <Suspense key={i} fallback={<span>·</span>}>
              <Late id={`many-${i}`} ms={200 + ((i * 37) % 23) * 60}>
                <span data-cell={i}>{i}</span>
              </Late>
            </Suspense>
          ))}
        </div>
      </Scenario>
    </ExampleShell>
  );
}
