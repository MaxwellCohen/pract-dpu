# Known issues found by the scenario suite

Each item is encoded as an expected-fail (`test.fail`) in `tests/`, so the suite stays green
while the issue exists and **turns red when it is fixed** (remove the `test.fail` then).
Observed with the pinned versions in the README, in Playwright's bundled Chromium, against the
dev server. Re-verify against the current stack before relying on any of these.

## 1. Boundary inside `<svg><foreignObject>` hangs the main thread
- Scenario: `/special?only=foreign-object`, test `foreign-object: page stays responsive`.
- Observed: `page.evaluate` never returns (main thread blocked). Reproduces with **all app JS
  blocked**, so it is the inline streaming/completion script, not hydration.
- Not yet root-caused. *Hypothesis (unverified):* the completion script re-parses the nearest
  `svg`/`math` ancestor (`innerHTML += ""`) after a patch; a re-parse inside `foreignObject`
  may keep re-triggering its own MutationObserver.

## 2. Empty resolved boundary never replaces its fallback
- Scenario: `/special?only=empty`, test `empty`.
- Observed: when the resolved children render nothing, no `<template for>` completion is emitted
  for that boundary, so the `Loading…` fallback stays in the document indefinitely.

## 3. `<tr>` rows streamed into a `<tbody>` are not shown
- Scenario: `/special?only=table-rows`, test `table-rows`.
- Observed: the completion for a boundary whose fallback/children are table rows does not produce
  visible `<tr>` rows in the `<tbody>` (parser-sensitive context). `<select>`/`<ul>` equivalents pass.

## Unexplained observation (not asserted)
- One run logged `pageerror: Cannot read properties of undefined (reading 'map')` while hydrating
  after patches had landed with client JS held (`/races?only=patch-interactive`). Hydration still
  succeeded. Needs a clean repro before it is a real issue.
