import { Component, ComponentChildren, VNode } from "preact";

//#region src/error-boundary.d.ts
/**
 * Props of the standalone `<ErrorBoundary>` component.
 *
 * Distinct from {@link ErrorBoundaryProps} in `types.ts`, which describes the
 * `{ error }` props the runtime passes to a route's or shell's exported
 * `ErrorBoundary`. That export handles the whole route; this component handles
 * a subtree the app chooses.
 */
interface ErrorBoundaryComponentProps {
  children?: ComponentChildren;
  /**
   * Rendered in place of the children once an error is caught. A function
   * receives the error and a `retry` callback that clears the captured error
   * and re-renders the children.
   */
  fallback?: ComponentChildren | ((error: Error, retry: () => void) => ComponentChildren);
  /** Called with every caught error, before the fallback renders. */
  onError?: (error: Error) => void;
}
interface ErrorBoundaryState {
  error: Error | null;
}
/**
 * Catch render errors in a subtree without taking down the page.
 *
 * A route or shell that wants to handle *its own* failures exports
 * `ErrorBoundary` instead; the runtime renders it with the route error. This
 * component is for the smaller case — an embedded widget, a lazy island, a
 * third-party integration — where only part of a working page should be
 * replaced.
 *
 * ```jsx
 * <ErrorBoundary fallback={(error, retry) => <Failed error={error} onRetry={retry} />}>
 *   <Editor />
 * </ErrorBoundary>
 * ```
 *
 * Promises thrown for suspension pass straight through: this boundary declines
 * them so `<Suspense>` still sees them. Without a `<Suspense>` ancestor the
 * promise keeps propagating, exactly as it would without this boundary.
 */
declare class ErrorBoundary extends Component<ErrorBoundaryComponentProps, ErrorBoundaryState> {
  state: ErrorBoundaryState;
  componentDidCatch(error: unknown): void;
  render(props: ErrorBoundaryComponentProps, state: ErrorBoundaryState): VNode;
  private retry;
}
//#endregion
export { ErrorBoundary, ErrorBoundaryComponentProps };