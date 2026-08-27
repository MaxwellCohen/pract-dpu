import { IslandStrategy } from "./types.mjs";
import * as _$preact from "preact";

//#region src/islands-server.d.ts
/**
 * Server-side islands support.
 *
 * The vite plugin's `virtual:pracht/server` module eagerly imports every
 * module in the islands directory and registers each exported component here.
 * A Preact `options.vnode` hook (the same technique Deno Fresh uses) then
 * retypes any vnode whose type is a registered island component to a boundary
 * component. During an islands-mode render (detected via context, so
 * concurrent async renders never interfere) the boundary wraps the island's
 * SSR output in a `<pracht-island>` marker carrying the island's module path,
 * export name, hydration strategy, and JSON-serialized props. Outside
 * islands-mode renders the boundary renders the component unchanged, so
 * islands behave like plain components on full-hydration routes.
 */
interface IslandDescriptor {
  /** Project-root-relative module path, e.g. "/src/islands/Counter.tsx". */
  file: string;
  /** Export name within the module ("default" for the default export). */
  exportName: string;
  /** Human-readable name used in error messages. */
  name: string;
}
interface IslandUsage {
  descriptor: IslandDescriptor;
  strategy: IslandStrategy;
}
/** Mutable collector threaded through an islands-mode render via context. */
interface IslandCapture {
  islands: IslandUsage[];
}
declare const IslandCaptureContext: _$preact.Context<IslandCapture | null>;
/**
 * Register island components discovered from the islands directory. Called by
 * the generated `virtual:pracht/server` module with the eager
 * `import.meta.glob` result. Safe to call multiple times (dev reloads).
 */
declare function registerServerIslands(modules: Record<string, unknown>): void;
declare function setIslandsClientEntryUrl(url: string | undefined): void;
/**
 * Validate that island props survive a JSON round trip unchanged. Throws a
 * descriptive error naming the offending prop path so the failure is easy to
 * fix during development.
 */
declare function validateIslandProps(props: Record<string, unknown>, descriptor: Pick<IslandDescriptor, "file" | "name">): void;
//#endregion
export { IslandCapture, IslandCaptureContext, IslandDescriptor, IslandUsage, registerServerIslands, setIslandsClientEntryUrl, validateIslandProps };