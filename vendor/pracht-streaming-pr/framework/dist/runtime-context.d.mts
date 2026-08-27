import { HrefRouteDefinition, RouteParams } from "./types.mjs";
import { DeferredHydrationReference } from "./defer.mjs";
import { SerializedRouteError } from "./runtime-errors.mjs";
import * as _$preact from "preact";
import { ComponentChildren } from "preact";

//#region src/runtime-context.d.ts
interface PrachtHydrationState<TData = unknown> {
  url: string;
  routeId: string;
  data: TData;
  /** Out-of-band locations replaced with Deferred values during streamed hydration. */
  deferred?: DeferredHydrationReference[];
  error?: SerializedRouteError | null;
  pending?: boolean;
  /**
   * Marks the static-export SPA fallback document (`200.html`). The document
   * is served for URLs with no prerendered file, so the client router ignores
   * the serialized `url` and boots from `window.location` instead.
   */
  fallback?: boolean;
}
interface StartAppOptions<TData = unknown> {
  initialData?: TData;
}
declare global {
  var __PRACHT_ROUTE_DEFINITIONS__: readonly HrefRouteDefinition[] | undefined;
  interface Window {
    __PRACHT_STATE__?: PrachtHydrationState;
  }
}
interface PrachtRuntimeValue {
  data: unknown;
  params: RouteParams;
  routeId: string;
  routes?: readonly HrefRouteDefinition[];
  url: string;
  /** True while this provider still owns the router's active route state. */
  isCurrent?: () => boolean;
  setData: (data: unknown) => void;
}
declare function PrachtRuntimeProvider<TData>({
  children,
  data,
  params,
  routeId,
  routes,
  stateVersion,
  url,
  isCurrent
}: {
  children: ComponentChildren;
  data: TData;
  params?: RouteParams;
  routeId: string;
  routes?: readonly HrefRouteDefinition[];
  stateVersion?: number;
  url: string;
  isCurrent?: () => boolean;
}): _$preact.VNode<_$preact.Attributes & {
  value: PrachtRuntimeValue | undefined;
  children?: ComponentChildren;
}>;
declare function startApp<TData = unknown>(options?: StartAppOptions<TData>): TData | undefined;
declare function readHydrationState<TData = unknown>(): PrachtHydrationState<TData> | undefined;
//#endregion
export { PrachtHydrationState, PrachtRuntimeProvider, StartAppOptions, readHydrationState, startApp };