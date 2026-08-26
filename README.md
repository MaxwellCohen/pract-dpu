# Suspense streaming (Preact / Pracht)

Demo app for **out-of-the-box Preact Suspense HTML streaming** via
`preact-render-to-string`’s `renderToReadableStream`: shell + fallbacks first,
then `<preact-island>` patches as each boundary resolves (JS applies the swap).

Page map matches the React + Waku / DPU twin so you can A/B behaviors. Native
[Declarative Partial Updates (DPU)](https://developer.chrome.com/blog/declarative-partial-updates)
markers are **not** wired yet — that comes later.

## Setup

```bash
npm install
npm run dev
```

Open the URL printed by the dev server (often `http://localhost:3001` if
`:3000` is already taken).

## Verify streaming

1. DevTools → Network → the document → **Response** (not `view-source:`)
2. Reload — you should see `<!--$s:…-->` / loading fallback first
3. ~1s later a `<preact-island>` chunk with the resolved UI

`view-source:` waits for the full response, then shows both halves in one
static document — use the Network panel to watch chunks arrive.

With **Turn JS off**, fallbacks stay after the stream finishes (expected until
DPU lands). With JS on, the island script swaps them in.

## Examples

| Route | What it shows |
|-------|----------------|
| `/basic` | One boundary around a slow panel |
| `/parallel` | Sibling boundaries that resolve independently |
| `/nested` | Outer shell streams, then inner content inside it |
| `/out-of-order` | Fast panel streams before a slower sibling finishes |
| `/grid` | Stress grid of 100 Suspense cells (not linked from nav) |

## Notes

This app patches `@pracht/core` / `@pracht/vite-plugin` on `postinstall`
(`scripts/patch-pracht-stream.mjs`) so SSR uses `renderToReadableStream`
instead of buffered `renderToStringAsync`, and so the Vite dev middleware
**pipes** HTML instead of `await response.text()`. Re-run
`node scripts/patch-pracht-stream.mjs` after reinstalling deps.

Suspense for streaming SSR comes from `preact/compat` (aliased over
`preact-suspense` in `vite.config.ts`) because that implementation drives the
chunked stream renderer today.
