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
