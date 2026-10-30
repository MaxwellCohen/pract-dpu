import type { Page } from "@playwright/test";

/** Hold back all client JS until `release()` — pushes hydration after streamed patches. */
export async function holdClientJs(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route(/\/assets\/.*\.js(\?.*)?$/, async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

/** Delay client JS by a fixed number of ms (hydrate "during" the stream). */
export async function delayClientJs(page: Page, ms: number) {
  await page.route(/\/assets\/.*\.js(\?.*)?$/, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

export const scenario = (page: Page, id: string) =>
  page.locator(`[data-scenario="${id}"]`);

/** Load one scenario in isolation (`?only=<id>`) so a hang/crash in one cannot mask the rest. */
export async function open(page: Page, path: string, only?: string) {
  // `commit`: some scenarios intentionally keep the stream open.
  await page.goto(only ? `${path}?only=${only}` : path, { waitUntil: "commit" });
}

/** True if the main thread still responds (catches infinite loops in client scripts). */
export async function isResponsive(page: Page, ms = 4000) {
  const r = await Promise.race([
    page.evaluate(() => "ok"),
    new Promise((res) => setTimeout(() => res("hung"), ms)),
  ]);
  return r === "ok";
}
