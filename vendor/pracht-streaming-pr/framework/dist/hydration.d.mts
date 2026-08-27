//#region src/hydration.d.ts
/**
 * Returns `true` once the initial hydration (including all Suspense
 * boundaries) has fully resolved. During SSR and hydration this returns
 * `false`.
 */
declare function useIsHydrated(): boolean;
//#endregion
export { useIsHydrated };