import { createResource } from "./resource";
import { sleep } from "./sleep";

export type RequestFlags = {
  noJs: boolean;
  path: string;
  /** Per-request Suspense resources so each navigation streams fresh delays. */
  resources: Map<string, { read(): unknown }>;
};

const defaults: RequestFlags = {
  noJs: false,
  path: "/",
  resources: new Map(),
};

let current: RequestFlags = defaults;

/** Server middleware sets this for the duration of a request render. */
export function setRequestFlags(
  flags: Omit<RequestFlags, "resources"> & { resources?: Map<string, { read(): unknown }> },
): void {
  current = {
    ...flags,
    resources: flags.resources ?? new Map(),
  };
}

export function clearRequestFlags(): void {
  current = defaults;
}

export function getRequestFlags(): RequestFlags {
  return current;
}

/**
 * Suspend for `ms` once per request under `key`.
 * Server-only: the HTML stream already resolves these boundaries (and the
 * stream runtime applies `<preact-island>` patches before hydration), so the
 * client must render the resolved tree on first paint — not re-suspend.
 */
export function readSleep(key: string, ms: number): void {
  if (typeof window !== "undefined") return;
  const map = getRequestFlags().resources;
  let resource = map.get(key);
  if (!resource) {
    resource = createResource(sleep(ms));
    map.set(key, resource);
  }
  resource.read();
}
