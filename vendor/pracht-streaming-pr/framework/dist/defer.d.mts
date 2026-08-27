//#region src/defer.d.ts
/**
 * Deferred loader values — `defer()` marks a slow field, `use()` reads it.
 *
 * A loader returns its object as usual and wraps the values that should not
 * hold up the response:
 *
 * ```ts
 * export async function loader({ params }: LoaderArgs) {
 *   const reviews = defer(getReviews(params.id));
 *   return {
 *     product: await getProduct(params.id), // overlaps with reviews
 *     reviews,
 *   };
 * }
 * ```
 *
 * The marker sits on the slow value rather than wrapping the whole return, so
 * the object keeps its shape, the type records exactly which fields defer, and
 * a route that calls `defer()` nowhere serializes byte-identically to before.
 *
 * Buffered documents and route-state responses resolve deferred values before
 * writing. An SSR route with `streaming: true` instead flushes its shell and
 * delivers the deferred values as they settle. The component API is identical
 * on both paths: `use()` accepts a settled value, a `Deferred`, or a bare
 * promise.
 *
 * Note that `ssg` and `isg` write files and therefore always resolve
 * everything — a static file cannot stream, and shipping fallback markup as
 * permanent output would be a correctness bug.
 */
declare const DEFERRED: unique symbol;
/**
 * A loader value that has been marked with {@link defer}.
 *
 * The type parameter is preserved so passing a `Deferred<T>` where `T` is
 * expected is a compile error — reading it goes through {@link use}.
 */
interface Deferred<T> {
  readonly [DEFERRED]: true;
  /** @internal Phantom field; carries `T` so the type is not structurally `any`. */
  readonly __deferred?: () => T;
}
/**
 * Mark a loader value as deferred.
 *
 * Accepts a promise, or a function returning one when the work should not
 * start until the value is read. Rejections surface where the value is read,
 * not from the loader.
 *
 * A deferred value may not redirect, throw a PrachtHttpError, or set headers:
 * by the time it settles the response status and headers are already decided.
 * Auth checks belong in middleware or in the awaited part of the loader.
 */
declare function defer<T>(source: Promise<T> | (() => Promise<T>)): Deferred<T>;
/**
 * Read a deferred value from inside a component.
 *
 * Suspends — throws the pending promise — until the value settles, so the
 * nearest `<Suspense>` boundary shows its fallback. A value that has already
 * settled (every path today, and `ssg`/`isg` always) is returned directly,
 * which is what lets one component work whether or not the route streams.
 *
 * A boundary is required and never inferred. On Preact 10 a boundary that
 * suspends must also resolve to exactly one DOM element — not `null`, not a
 * multi-child fragment — or hydration mismatches.
 */
type UsedValue<T> = T extends Deferred<infer TValue> ? TValue : T extends Promise<infer TValue> ? TValue : T;
declare function use<T>(value: T): UsedValue<T>;
type DeferredPathSegment = string | number;
interface DeferredHydrationReference {
  id: string;
  path: DeferredPathSegment[];
}
//#endregion
export { Deferred, DeferredHydrationReference, defer, use };