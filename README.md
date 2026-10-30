# Preact streaming / DPU playground

Harness for experimenting with **Preact Suspense HTML streaming** and swapping
stock `<preact-island>` patches for
[Declarative Partial Updates (DPU)](https://developer.chrome.com/blog/declarative-partial-updates).

Demos are plain `<Suspense>` + thrown promises — not Pracht `defer()` /
`use()`. Streaming SSR comes from a vendored build of
[Pracht PR #340](https://github.com/JoviDeCroock/pracht/pull/340)
(`streaming: true`). Refresh with `npm run sync:pracht-pr`.

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3004](http://localhost:3004).

## Verify streaming

1. DevTools → Network → the document → **Response** (not `view-source:`)
2. Reload — fallbacks first (`<!--$s:…-->`), then `<preact-island>` (or your DPU markers)

## Examples

| Route | What it shows |
|-------|----------------|
| `/basic` | One Suspense boundary |
| `/parallel` | Sibling boundaries resolve independently |
| `/nested` | Outer then inner |
| `/out-of-order` | Fast sibling before slow |
| `/grid` | 100 Suspense cells |

## Where to hack DPU

Today `preact-render-to-string` emits Suspense markers + `<preact-island>` and
the browser CE swaps them in. To try DPU, alias or patch:

- `preact` / `preact-render-to-string` (what the stream emits)
- client apply path (stock island CE vs DPU)

Keep page components on Suspense so the only moving part is how resolved HTML
is applied.

## Scenario suite (hydration races + special cases)

Two fixture routes plus a Playwright suite, intended to be run by humans **or agents**:

| Route | Covers |
|-------|--------|
| `/races` | patch before / during / after hydration, input + focus preservation, client-render-wins-over-late-patch, adjacent + nested + 60 boundaries |
| `/special` | table rows, `<select>`, lists, textarea, `<details>`, autofocus, inline `<script>`, text-only / empty / multi-root boundaries, custom element, `foreignObject`, error boundary, slow boundary, entity escaping |
| `/edge-cases` | popcorning, SVG / MathML namespace, style hoisting (pre-existing visual comparisons) |

Every scenario is a card with `data-scenario="<id>"` and an **Expected:** line. Add `?only=<id>[,<id>]`
to render just those scenarios (so one failure/hang cannot mask the others).

### Run it

```bash
pnpm install
pnpm test:install        # Chromium for Playwright
pnpm test                # starts `pracht dev` on :3104, runs everything
BASE_URL=https://<deployment> pnpm test   # run against a deployed build instead
```

Machine-readable results: `results/results.json` (Playwright JSON). Failures that are understood are
encoded as expected-fail tests and described in [KNOWN_ISSUES.md](./KNOWN_ISSUES.md). A fix flips
its test to "unexpectedly passed" → delete the `test.fail`.

Client timing is controlled by delaying `/assets/*.js` (`tests/helpers.ts`: `holdClientJs`,
`delayClientJs`); server timing by fixed per-boundary delays in the routes.

### Pinned stack under test

- Streaming SSR: vendored [Pracht PR #340](https://github.com/JoviDeCroock/pracht/pull/340) build (`vendor/pracht-streaming-pr`)
- `preact-render-to-string`: `package.json` → commit `da72a46b` of `MaxwellCohen/preact-render-to-string`
- `preact`: see `package.json`

Results are only meaningful for this stack; bump the pins, re-run, and update `KNOWN_ISSUES.md`.

## Made with LLMs

The scenario routes, Playwright suite, and these docs were written with Claude (Anthropic) via
Claude Code, directed by the repo owner. Treat the expectations as **proposals to review**, not
ground truth: they encode what an LLM and the owner believed DPU/Suspense streaming *should* do.
If an expectation looks wrong, say so — that is a useful result too. Root-cause statements marked
"hypothesis" are unverified.
