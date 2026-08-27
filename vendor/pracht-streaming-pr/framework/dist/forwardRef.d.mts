import { FunctionComponent } from "preact";

//#region src/forwardRef.d.ts
/**
 * Pass ref down to a child. This is mainly used in libraries with HOCs that
 * wrap components. Using `forwardRef` there is an easy way to get a reference
 * of the wrapped component instead of one of the wrapper itself.
 */
declare function forwardRef<P = {}>(fn: ((props: P, ref: any) => any) & {
  displayName?: string;
}): FunctionComponent<P & {
  ref?: any;
}>;
//#endregion
export { forwardRef };