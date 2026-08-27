import { NavigateOptions, ResolvedPrachtApp, RouteId, RouteTarget } from "./types.mjs";
import { PrachtHydrationState } from "./runtime-context.mjs";

//#region src/router.d.ts
declare global {
  interface Window {
    __PRACHT_NAVIGATE__?: InternalNavigateFn;
    __PRACHT_ROUTER_READY__?: boolean;
  }
}
type ModuleMap = Record<string, () => Promise<unknown>>;
interface NavigateFn {
  (to: string, options?: NavigateOptions): Promise<void>;
  <TRoute extends RouteId>(to: RouteTarget<TRoute>, options?: NavigateOptions): Promise<void>;
}
interface InternalNavigateOptions extends NavigateOptions {
  _popstate?: boolean;
  _reloadRouteState?: boolean;
  /**
   * Static-export fallback boot (`200.html`): a failed route-state fetch must
   * render without loader data instead of reloading the document — the host
   * would answer the reload with this same fallback document and loop.
   */
  _staticFallback?: boolean;
}
interface InternalNavigateFn {
  (to: string, options?: InternalNavigateOptions): Promise<void>;
  <TRoute extends RouteId>(to: RouteTarget<TRoute>, options?: InternalNavigateOptions): Promise<void>;
}
declare function useNavigate(): NavigateFn;
interface InitClientRouterOptions {
  app: ResolvedPrachtApp;
  routeModules: ModuleMap;
  shellModules: ModuleMap;
  initialState: PrachtHydrationState;
  root: HTMLElement;
  findModuleKey: (modules: ModuleMap, file: string) => string | null;
}
declare function initClientRouter(options: InitClientRouterOptions): Promise<void>;
//#endregion
export { InitClientRouterOptions, NavigateFn, initClientRouter, useNavigate };