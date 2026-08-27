//#region src/navigation-state.d.ts
/**
 * Shared reactive store for the current client navigation / form submission.
 *
 * The client router (`router.ts`) and `<Form>` (`runtime-hooks.ts`) write to
 * this store; `useNavigation()` subscribes to it. The store lives in its own
 * module so both writers can import it without creating a cycle, and so it
 * stays safe to import during SSR (no `window` access at module scope).
 */
interface NavigationLocation {
  pathname: string;
  search: string;
  hash: string;
  href: string;
}
type Navigation = {
  state: "idle";
  location?: undefined;
  formData?: undefined;
} | {
  state: "loading";
  location: NavigationLocation;
  formData?: undefined;
} | {
  state: "submitting";
  location: NavigationLocation;
  formData: FormData;
};
//#endregion
export { Navigation, NavigationLocation };