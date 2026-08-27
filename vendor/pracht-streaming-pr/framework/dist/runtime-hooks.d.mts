import { ApiPath, CapabilityEnvelope, CapabilityOutputFor, HttpCapabilityName, LinkPrefetchStrategy, LoaderData, LoaderLike, RouteDataFor, RouteId, RouteParams, RouteTarget } from "./types.mjs";
import { ApiValidationIssue } from "./api-validation.mjs";
import { Navigation, NavigationLocation } from "./navigation-state.mjs";
import { PrachtHydrationState, PrachtRuntimeProvider, StartAppOptions, readHydrationState, startApp } from "./runtime-context.mjs";
import * as _$preact from "preact";
import { JSX, h } from "preact";
import { StandardSchemaV1 } from "@standard-schema/spec";

//#region src/runtime-hooks.d.ts
/** Envelope data type for a capability name, when typegen has registered it. */
type CapabilityFormResult<TName extends string> = CapabilityEnvelope<CapabilityOutputFor<TName>>;
interface FormProps<TName extends HttpCapabilityName = HttpCapabilityName> extends Omit<JSX.HTMLAttributes<HTMLFormElement>, "action" | "method"> {
  /**
   * Form action. Autocompletes API route paths registered by `pracht typegen`
   * while still accepting any URL string (dynamic segments must be
   * interpolated by the caller).
   */
  action?: ApiPath | (string & {});
  method?: string;
  /**
   * Post this form to a capability's HTTP projection instead of an `action`
   * URL — the same endpoint agents call, so the human form and the agent
   * tool literally share one contract. Fields are coerced onto the
   * capability's input schema server-side; after a successful submission the
   * active route's data revalidates automatically. Works without JavaScript:
   * the endpoint accepts the form-encoded fallback and redirects back to the
   * page. Set `action` explicitly for capabilities with a custom
   * `expose.http.path`; root-absolute actions receive the deploy base. A
   * button-level `formaction` is native child markup, so wrap a local
   * root-absolute override with `withBase()` when the app uses a deploy base.
   *
   * Only http-exposed capabilities are accepted: a private one has no endpoint
   * to post to, so naming it here is a compile error rather than a 404 at
   * submit time. Before `pracht typegen` has run, any name is accepted.
   */
  capability?: TName;
  /** Called with the typed envelope after a `capability` submission settles. */
  onCapabilityResult?: (envelope: CapabilityFormResult<TName>) => void;
  /**
   * Standard Schema validated against the form's data (one entry per field,
   * arrays for repeated fields) before submitting. When validation fails the
   * request is skipped and `onValidationIssues` fires with the issues.
   */
  schema?: StandardSchemaV1;
  /**
   * Called with normalized validation issues when the client-side `schema`
   * rejects a submission, or when the server responds with the standardized
   * validation failure produced by `defineApi()` (HTTP 400/422,
   * `{ error: "validation", issues }`).
   */
  onValidationIssues?: (issues: ApiValidationIssue[]) => void;
  /**
   * Called with the server's response for every non-redirect fetch
   * submission — success payloads (2xx) and failures (4xx/5xx) alike. Read
   * the body with `response.json()`; validation-issue handling parses a
   * clone, so the body is never consumed before this callback.
   */
  onResponse?: (response: Response) => void;
}
/**
 * Carried by `LinkProps["href"]` purely so the compiler error names the fix.
 *
 * Omitting `href` from the props type leaves TypeScript to guess: it reports
 * `Property 'href' does not exist … Did you mean 'ref'?`, which sends the
 * reader looking for a typo rather than at the actual API. `href` is the
 * muscle-memory prop from every other router, so this is the first wall a new
 * app hits — and the runtime accepted it, so `pracht dev` said nothing either
 * (that part is guarded in `Link` itself). A single-value string type puts the
 * guidance in the error message.
 *
 * Two callers hit it, so the sentence has to read correctly for both. One wrote
 * `href` instead of `route`. The other already wrote `route` and reached the
 * error through a spread — JSX does not excess-property-check spreads, so an
 * `href` arriving that way used to compile and be silently dropped; naming only
 * the first case would tell that author to do what they already did.
 *
 * Keep it under ~260 characters as TypeScript prints it. Both TypeScript 5.4
 * and 6.0 print a 261-character type in full and truncate a 361-character one
 * with `...`, which would swallow the end of the sentence.
 */
type LinkHrefGuidance = "`href` is not a <Link> prop: <Link> builds its own href from `route` and `params`. Use a generated route id with <Link route={routeId}>, a plain <a href> for external and user-provided URLs, or omit href from the props you spread here.";
/**
 * `JSX.AnchorHTMLAttributes`, not `JSX.HTMLAttributes`. Preact keeps the
 * anchor-specific attributes — `target`, `rel`, `download`, `ping`,
 * `referrerpolicy`, `hreflang` — on the anchor interface, so basing `LinkProps`
 * on the generic one rejected all of them: `<Link route="home" target="_blank">`
 * did not typecheck. It also meant the `Omit<…, "href">` below removed nothing,
 * because `href` was never in the generic interface either; that, not the
 * `Omit`, is why the compiler used to answer `<Link href>` with
 * `Did you mean 'ref'?`.
 */
type LinkProps<TRoute extends RouteId = RouteId> = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & RouteTarget<TRoute> & {
  /**
   * Not a real prop — see {@link LinkHrefGuidance}. `<Link>` builds its own
   * `href` from `route` and `params`.
   */
  href?: LinkHrefGuidance;
  /**
   * Prefetch strategy for this link, overriding the route-level strategy:
   * `"intent"` (hover/focus), `"viewport"` (IntersectionObserver),
   * `"render"` (as soon as the link mounts), or `"none"`. When omitted the
   * route's `prefetch` meta applies (default: `"intent"`).
   */
  prefetch?: LinkPrefetchStrategy; /** Keep the current scroll position when this link navigates. */
  preserveScroll?: boolean;
  /**
   * Wrap the navigation triggered by this link in
   * `document.startViewTransition()` when supported.
   */
  viewTransition?: boolean;
  /**
   * Opt this link out of (`false`) or back into (`true`) the browser's
   * speculation rules, overriding any enclosing
   * `data-pracht-speculate="off"` scope. Independent of `prefetch`, which
   * controls the JS route-state prefetch; disable both on links with side
   * effects.
   */
  speculate?: boolean;
};
interface Location {
  pathname: string;
  search: string;
}
type ReadonlyURLSearchParams = Omit<URLSearchParams, "append" | "delete" | "set" | "sort">;
declare function useRouteData<TRoute extends RouteId>(routeId: TRoute): RouteDataFor<TRoute>;
declare function useRouteData<TLoader extends LoaderLike>(): LoaderData<TLoader>;
declare function useRouteData<TData = unknown>(): TData;
declare function useLocation(): Location;
/** Read the current URL search parameters reactively. */
declare function useSearchParams(): ReadonlyURLSearchParams;
declare function useParams(): RouteParams;
declare function useRevalidate(): () => Promise<unknown>;
/**
 * Reactive pending state for the current client navigation or `<Form>`
 * submission. Returns `{ state: "idle" }` when nothing is in flight,
 * `{ state: "loading", location }` while the router fetches and commits a
 * navigation, and `{ state: "submitting", location, formData }` while a
 * `<Form>` submission is awaiting its response. During SSR it always
 * returns the idle state.
 */
declare function useNavigation(): Navigation;
declare function Link<TRoute extends RouteId>(props: LinkProps<TRoute>): _$preact.VNode<_$preact.ClassAttributes<HTMLAnchorElement> & h.JSX.HTMLAttributes<HTMLAnchorElement>>;
declare function Form<TName extends HttpCapabilityName = HttpCapabilityName>(props: FormProps<TName>): _$preact.VNode<_$preact.ClassAttributes<HTMLFormElement> & h.JSX.HTMLAttributes<HTMLFormElement>>;
//#endregion
export { Form, FormProps, Link, LinkHrefGuidance, LinkProps, Location, ReadonlyURLSearchParams, useLocation, useNavigation, useParams, useRevalidate, useRouteData, useSearchParams };