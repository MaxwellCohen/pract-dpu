import { Suspense } from "@pracht/core";
import { Component as PreactComponent } from "preact";
import type { ComponentChildren } from "preact";
import { ExampleShell } from "../components/example-shell";
import { Scenario } from "../components/scenario";
import { readSleep } from "../lib/request-flags";

function Late({ id, ms = 500, children }: { id: string; ms?: number; children?: ComponentChildren }) {
  readSleep(`special:${id}`, ms);
  return <>{children}</>;
}

function Boom(): never {
  readSleep("special:boom", 400);
  throw new Error("boom");
}

class Catch extends PreactComponent<{ children?: ComponentChildren }, { err: boolean }> {
  state = { err: false };
  componentDidCatch() {
    this.setState({ err: true });
  }
  static getDerivedStateFromError() {
    return { err: true };
  }
  render() {
    return this.state.err ? <p data-testid="caught">caught</p> : this.props.children;
  }
}

const fb = (t = "Loading…") => <p data-testid="fallback">{t}</p>;

export function head() {
  return { title: "Special scenarios · Suspense streaming" };
}

export function Component() {
  return (
    <ExampleShell
      title="Special scenarios"
      description="Parser-sensitive contexts, form state, scripts, failure modes, and other awkward shapes for DPU patches."
    >
      <Scenario id="table-rows" title="Table rows" expected="Both <tr> rows appear inside the <tbody> in order.">
        <table>
          <tbody>
            <tr><td>static</td></tr>
            <Suspense fallback={<tr data-testid="fallback"><td>loading</td></tr>}>
              <Late id="table-rows">
                <tr data-testid="row-a"><td>A</td></tr>
                <tr data-testid="row-b"><td>B</td></tr>
              </Late>
            </Suspense>
          </tbody>
        </table>
      </Scenario>

      <Scenario id="select-options" title="Select options" expected="Three options appear in the <select>; the second is selected.">
        <select data-testid="sel">
          <Suspense fallback={<option>loading</option>}>
            <Late id="select-options">
              <option value="1">one</option>
              <option value="2" selected>two</option>
              <option value="3">three</option>
            </Late>
          </Suspense>
        </select>
      </Scenario>

      <Scenario id="list-items" title="List items" expected="Three <li> children, no stray wrapper elements.">
        <ul data-testid="ul">
          <Suspense fallback={<li>loading</li>}>
            <Late id="list-items">
              <li>1</li><li>2</li><li>3</li>
            </Late>
          </Suspense>
        </ul>
      </Scenario>

      <Scenario id="textarea-value" title="Textarea default value" expected="Textarea shows 'hello' after the patch.">
        <Suspense fallback={fb()}>
          <Late id="textarea-value">
            <textarea data-testid="ta" defaultValue="hello" />
          </Late>
        </Suspense>
      </Scenario>

      <Scenario id="details-open" title="Details open state" expected="<details open> is open after the patch.">
        <Suspense fallback={fb()}>
          <Late id="details-open">
            <details open data-testid="details"><summary>s</summary>body</details>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario id="autofocus" title="Autofocus in a patch" expected="Record whether the patched input is focused (browser-dependent); must not throw.">
        <Suspense fallback={fb()}>
          <Late id="autofocus">
            <input data-testid="af" autofocus />
          </Late>
        </Suspense>
      </Scenario>

      <Scenario id="inline-script" title="Inline script inside a patch" expected="Script does not execute from a declarative patch unless the parser would execute it; document the observed behaviour via window.__scriptRan.">
        <Suspense fallback={fb()}>
          <Late id="inline-script">
            <script dangerouslySetInnerHTML={{ __html: "window.__scriptRan=(window.__scriptRan||0)+1" }} />
            <p data-testid="script-done">done</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario id="text-only" title="Text-only boundary" expected="Text node replaces the fallback; no element wrapper needed.">
        <p data-testid="text-host">
          <Suspense fallback="loading">
            <Late id="text-only">resolved text</Late>
          </Suspense>
        </p>
      </Scenario>

      <Scenario id="empty" title="Empty boundary" expected="Fallback is removed and nothing replaces it.">
        <div data-testid="empty-host">
          <Suspense fallback={fb()}>
            <Late id="empty" />
          </Suspense>
        </div>
      </Scenario>

      <Scenario id="multi-root" title="Fragment with multiple roots" expected="Three sibling roots appear in order.">
        <div data-testid="multi-host">
          <Suspense fallback={fb()}>
            <Late id="multi-root">
              <b>1</b><i>2</i><u>3</u>
            </Late>
          </Suspense>
        </div>
      </Scenario>

      <Scenario id="custom-element" title="Custom element" expected="Element upgrades if defined; node is present either way.">
        <Suspense fallback={fb()}>
          <Late id="custom-element">
            {/* @ts-expect-error custom element */}
            <x-dpu-demo data-testid="ce">custom</x-dpu-demo>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario id="foreign-object" title="HTML inside SVG foreignObject" expected="HTML paragraph renders (HTML namespace) inside foreignObject.">
        <svg width="200" height="60">
          <foreignObject width="200" height="60">
            <Suspense fallback={fb()}>
              <Late id="foreign-object">
                <p data-testid="fo">html in svg</p>
              </Late>
            </Suspense>
          </foreignObject>
        </svg>
      </Scenario>

      <Scenario id="error-boundary" title="Boundary that throws" expected="Error boundary content ('caught') is shown; page does not break other scenarios.">
        <Catch>
          <Suspense fallback={fb()}>
            <Boom />
          </Suspense>
        </Catch>
      </Scenario>

      <Scenario id="never-resolves" title="Slow boundary (8s) that stays pending during the test window" expected="Fallback stays; page remains interactive and other boundaries unaffected.">
        <Suspense fallback={fb("still waiting")}>
          <Late id="never-resolves" ms={8000}>
            <p>never</p>
          </Late>
        </Suspense>
      </Scenario>

      <Scenario id="entity-escaping" title="Entities and markup-like text" expected="Text '<b>&amp;</b> --> ]]>' is shown literally, not parsed.">
        <Suspense fallback={fb()}>
          <Late id="entity-escaping">
            <p data-testid="ent">{"<b>&amp;</b> --> ]]>"}</p>
          </Late>
        </Suspense>
      </Scenario>
    </ExampleShell>
  );
}
