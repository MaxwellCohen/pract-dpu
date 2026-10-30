import { expect, test } from "@playwright/test";
import { isResponsive, open, scenario } from "./helpers";

const t = (page: any, id: string) => scenario(page, id);

// KNOWN ISSUE (KNOWN_ISSUES.md #3): <tr> rows streamed into a <tbody> never become visible.
test("table-rows", async ({ page }) => {
  test.fail(true, "KNOWN_ISSUES.md #3");
  await open(page, "/special", "table-rows");
  const s = t(page, "table-rows");
  await expect(s.getByTestId("row-a")).toBeVisible();
  await expect(s.getByTestId("row-b")).toBeVisible();
  await expect(s.locator("tbody > tr")).toHaveCount(3);
  await expect(s.getByTestId("fallback")).toHaveCount(0);
});

test("select-options", async ({ page }) => {
  await open(page, "/special", "select-options");
  const s = t(page, "select-options");
  await expect(s.locator("option")).toHaveCount(3);
  await expect(s.getByTestId("sel")).toHaveValue("2");
});

test("list-items", async ({ page }) => {
  await open(page, "/special", "list-items");
  await expect(t(page, "list-items").locator("ul > li")).toHaveCount(3);
});

test("textarea-value", async ({ page }) => {
  await open(page, "/special", "textarea-value");
  await expect(t(page, "textarea-value").getByTestId("ta")).toHaveValue("hello");
});

test("details-open", async ({ page }) => {
  await open(page, "/special", "details-open");
  await expect(t(page, "details-open").getByTestId("details")).toHaveAttribute("open", "");
});

test("inline-script (observe)", async ({ page }) => {
  await open(page, "/special", "inline-script");
  await expect(t(page, "inline-script").getByTestId("script-done")).toBeVisible();
  const ran = await page.evaluate(() => (window as any).__scriptRan ?? 0);
  test.info().annotations.push({ type: "observed", description: `script ran ${ran}x` });
});

test("text-only", async ({ page }) => {
  await open(page, "/special", "text-only");
  const host = t(page, "text-only").getByTestId("text-host");
  await expect(host).toHaveText("resolved text");
});

// KNOWN ISSUE (KNOWN_ISSUES.md #2): an empty resolved boundary emits no completion, so the fallback stays.
test("empty", async ({ page }) => {
  test.fail(true, "KNOWN_ISSUES.md #2");
  await open(page, "/special", "empty");
  const s = t(page, "empty");
  await expect(s.getByTestId("fallback")).toHaveCount(0);
  await expect(s.getByTestId("empty-host")).toHaveText("");
});

test("multi-root", async ({ page }) => {
  await open(page, "/special", "multi-root");
  await expect(t(page, "multi-root").getByTestId("multi-host")).toHaveText("123");
});

test("custom-element", async ({ page }) => {
  await open(page, "/special", "custom-element");
  await expect(t(page, "custom-element").getByTestId("ce")).toHaveText("custom");
});

// KNOWN ISSUE (see KNOWN_ISSUES.md #1): a boundary inside <svg><foreignObject> hangs the main thread
// with the inline DPU script, even with all app JS blocked.
test("foreign-object: page stays responsive", async ({ page }) => {
  test.fail(true, "KNOWN_ISSUES.md #1");
  await open(page, "/special", "foreign-object");
  await page.waitForTimeout(1500);
  expect(await isResponsive(page)).toBe(true);
});

test.skip("foreign-object html namespace", async ({ page }) => {
  await open(page, "/special", "foreign-object");
  const p = t(page, "foreign-object").getByTestId("fo");
  await expect(p).toBeVisible();
  expect(await p.evaluate((n) => n.namespaceURI)).toBe("http://www.w3.org/1999/xhtml");
});

test("error-boundary", async ({ page }) => {
  await open(page, "/special", "error-boundary");
  await expect(t(page, "error-boundary").getByTestId("caught")).toBeVisible();
});

test("slow boundary stays pending, page usable", async ({ page }) => {
  await open(page, "/special", "never-resolves");
  const s = t(page, "never-resolves");
  await page.waitForTimeout(1500);
  await expect(s.getByTestId("fallback")).toHaveText("still waiting");
});

test("entity-escaping", async ({ page }) => {
  await open(page, "/special", "entity-escaping");
  await expect(t(page, "entity-escaping").getByTestId("ent")).toHaveText("<b>&amp;</b> --> ]]>");
});
