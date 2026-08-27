import { Register } from "./types.mjs";

//#region src/env.d.ts
/**
 * Prefix that marks an environment variable as safe to expose to the client.
 * The pracht Vite plugin adds this prefix to Vite's `envPrefix`, so matching
 * variables are statically inlined into `import.meta.env` at build time.
 */
declare const PRACHT_PUBLIC_ENV_PREFIX = "PRACHT_PUBLIC_";
/**
 * The env shape registered by the app via declaration merging:
 *
 * ```ts
 * // src/env.d.ts
 * declare module "@pracht/core" {
 *   interface Register {
 *     env: {
 *       DATABASE_URL: string;
 *       PRACHT_PUBLIC_APP_NAME: string;
 *     };
 *   }
 * }
 * ```
 */
type RegisteredEnv = Register extends {
  env: infer TEnv;
} ? TEnv : never;
type HasRegisteredEnv = [RegisteredEnv] extends [never] ? false : true;
type FallbackEnv = Record<string, string | undefined>;
/** Extracts the `PRACHT_PUBLIC_`-prefixed subset of an env shape. */
type PublicEnvOf<TEnv> = { readonly [TKey in keyof TEnv as TKey extends `PRACHT_PUBLIC_${string}` ? TKey : never]: TEnv[TKey] };
/** The server-side env shape — the full registered env, or a loose record. */
type PrachtServerEnv = HasRegisteredEnv extends true ? Readonly<RegisteredEnv> : FallbackEnv;
/** The client-safe env shape — only `PRACHT_PUBLIC_`-prefixed variables. */
type PrachtPublicEnv = HasRegisteredEnv extends true ? PublicEnvOf<RegisteredEnv> : FallbackEnv;
/**
 * Returns the subset of `source` whose keys start with `PRACHT_PUBLIC_` and
 * whose values are strings. Everything else is dropped.
 */
declare function filterPublicEnv(source: Record<string, unknown> | undefined): FallbackEnv;
/**
 * Client-safe environment access. Only exposes variables prefixed with
 * `PRACHT_PUBLIC_`; values are inlined into the client bundle at build time,
 * so never put secrets behind the prefix. Safe to import anywhere.
 */
declare const publicEnv: PrachtPublicEnv;
//#endregion
export { PRACHT_PUBLIC_ENV_PREFIX, PrachtPublicEnv, PrachtServerEnv, PublicEnvOf, filterPublicEnv, publicEnv };