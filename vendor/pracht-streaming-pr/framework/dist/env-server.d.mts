import { PrachtServerEnv, PublicEnvOf } from "./env.mjs";

//#region src/env-server.d.ts
/**
 * Install the platform's env bindings as the source behind `serverEnv`.
 * Adapters call this — the Cloudflare adapter installs the worker `env`
 * bindings when the first request arrives; Node-based runtimes do not need
 * it because `serverEnv` falls back to `process.env`.
 */
declare function setServerEnv(env: Record<string, unknown> | undefined): void;
/**
 * Server-only environment access. Resolves to `process.env` on Node-based
 * runtimes (Node adapter, Vercel) and to the worker env bindings on
 * Cloudflare. Importing `@pracht/core/env/server` from client code fails the
 * build. Type it once via declaration merging on the `Register` interface:
 *
 * ```ts
 * declare module "@pracht/core" {
 *   interface Register {
 *     env: { DATABASE_URL: string; PRACHT_PUBLIC_APP_NAME: string };
 *   }
 * }
 * ```
 */
declare const serverEnv: PrachtServerEnv;
//#endregion
export { type PrachtServerEnv, type PublicEnvOf, serverEnv, setServerEnv };