import { Plugin } from "vite";

//#region src/index.d.ts
type FilterPattern = string | RegExp | ReadonlyArray<string | RegExp>;
interface PreactSsrPrecompileOptions {
  /** Files to transform. Defaults to JS/TS files, including JSX/TSX. */
  include?: FilterPattern;
  /** Files to skip. Defaults to node_modules. */
  exclude?: FilterPattern;
  /** JSX runtime import source. Imports are generated from `${importSource}/jsx-runtime`. */
  importSource?: string;
  /** Run only for Vite SSR transforms. Defaults to true. */
  ssrOnly?: boolean;
  /** Additional lowercase HTML element names to keep on the normal JSX path. */
  skipElements?: string[];
  /** Attributes that should always be serialized at runtime with `jsxAttr()`. */
  dynamicProps?: string[];
}
interface TransformPreactSsrJsxOptions {
  importSource?: string;
  skipElements?: string[];
  dynamicProps?: string[];
}
/**
 * Create a Vite/Rolldown plugin that precompiles safe Preact JSX for server
 * bundles into `jsxTemplate()` calls understood by `preact-render-to-string`.
 */
declare function preactSsrPrecompile(options?: PreactSsrPrecompileOptions): Plugin;
/** Transform JSX in a single module. Exposed for tests and non-Vite integrations. */
declare function transformPreactSsrJsx(code: string, id?: string, options?: TransformPreactSsrJsxOptions): string | null;
//#endregion
export { PreactSsrPrecompileOptions, TransformPreactSsrJsxOptions, preactSsrPrecompile as default, preactSsrPrecompile, transformPreactSsrJsx };