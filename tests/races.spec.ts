import { expect, test } from "@playwright/test";
import { delayClientJs, holdClientJs, open, scenario } from "./helpers";

// Three hydration timings: patches land BEFORE hydration (JS held), DURING
// (JS delayed mid-stream), AFTER (no delay).
const timings = ["before", "during", "after"] as const;

for (const timing of timings) {
  test.describe(`hydration ${timing} patch`, () => {
    let release: (() => void) | undefined;

    test.beforeEach(async ({ page }) => {
      if (timing === "before") release = await holdClientJs(page);
      if (timing === "during") await delayClientJs(page, 700);
      await open(page, "/races");
    });

    test("patched counter is interactive", async ({ page }) => {
      const s = scenario(page, "patch-interactive");
      await expect(s.getByTestId("patched-btn")).toBeVisible();
      release?.();
      // A click can land on patched-in HTML a few ms before hydration attaches
      // its handler; such clicks are lost (no event replay). Retry until live.
      await expect(async () => {
        await s.getByTestId("patched-btn").click();
        expect(Number(await s.getByTestId("patched-count").textContent())).toBeGreaterThan(0);
      }).toPass({ timeout: 8000 });
      await expect(s.getByTestId("patched-btn")).toHaveCount(1);
    });

    test("adjacent boundaries both patch", async ({ page }) => {
      const s = scenario(page, "adjacent-boundaries");
      await expect(s.getByTestId("adj-a")).toBeVisible();
      await expect(s.getByTestId("adj-b")).toBeVisible();
      release?.();
    });

    test("nested inner-first yields one copy each", async ({ page }) => {
      const s = scenario(page, "nested-inner-first");
      await expect(s.getByTestId("nest-inner")).toBeVisible({ timeout: 8000 });
      release?.();
      await expect(s.getByTestId("nest-outer")).toHaveCount(1);
      await expect(s.getByTestId("nest-inner")).toHaveCount(1);
    });

    test("60 boundaries fill exactly once", async ({ page }) => {
      const grid = scenario(page, "many-boundaries").getByTestId("many-grid");
      await expect(grid.locator("[data-cell]")).toHaveCount(60, { timeout: 15000 });
      release?.();
      const ids = await grid.locator("[data-cell]").evaluateAll((n) => n.map((e) => e.getAttribute("data-cell")));
      expect(new Set(ids).size).toBe(60);
    });

    test("client render wins over late patch: single copy", async ({ page }) => {
      const s = scenario(page, "client-wins");
      release?.();
      await expect(s.getByTestId("client-wins-content")).toHaveCount(1, { timeout: 8000 });
      await page.waitForTimeout(500);
      await expect(s.getByTestId("client-wins-content")).toHaveCount(1);
    });
  });
}

test("typed input in shell survives sibling patch", async ({ page }) => {
  await open(page, "/races");
  const s = scenario(page, "typed-input");
  const input = s.getByTestId("typed-input");
  await input.fill("keep me");
  await expect(s.getByTestId("typed-sibling")).toBeVisible();
  await expect(input).toHaveValue("keep me");
});

test("focus outside boundary survives patch", async ({ page }) => {
  await open(page, "/races");
  const s = scenario(page, "focus-in-shell");
  await s.getByTestId("focus-input").focus();
  await expect(s.getByTestId("focus-done")).toBeVisible();
  await expect(s.getByTestId("focus-input")).toBeFocused();
});

test("fallback input is replaced, no duplicates", async ({ page }) => {
  await open(page, "/races");
  const s = scenario(page, "typed-input-inside");
  await expect(s.getByTestId("done-input")).toBeVisible();
  await expect(s.locator("input")).toHaveCount(1);
});

test("shell click before hydration does not break later hydration", async ({ page }) => {
  const release = await holdClientJs(page);
  await open(page, "/races");
  const s = scenario(page, "click-before-hydration");
  await s.getByTestId("shell-btn").click({ force: true });
  await expect(s.getByTestId("click-done")).toBeVisible();
  release();
  await expect(async () => {
    await s.getByTestId("shell-btn").click();
    expect(Number(await s.getByTestId("shell-count").textContent())).toBeGreaterThan(0);
  }).toPass({ timeout: 8000 });
});
