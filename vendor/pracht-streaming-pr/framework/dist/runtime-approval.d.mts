import { CapabilityApprovalPrincipalResolver, CapabilityApprovalStore, PrachtRequestContext } from "./types.mjs";
//#region src/runtime-approval.d.ts
/**
 * Register the store backing destructive-capability approvals. Call it from a
 * server-only module (a capability module, middleware applied to the
 * capability/API chain, or a custom server entry). Passing `null` unregisters.
 */
declare function setCapabilityApprovalStore(store: CapabilityApprovalStore | null): void;
/**
 * Register a server-only resolver for the application-authenticated identity
 * bound to approval proposals. Human approval without either this identity or
 * a verified agent identity fails closed.
 */
declare function setCapabilityApprovalPrincipalResolver<TContext = PrachtRequestContext>(resolver: CapabilityApprovalPrincipalResolver<TContext> | null): void;
interface MemoryApprovalStoreOptions {
  /**
   * Clock override. MUST return **unix seconds**, not milliseconds — every
   * record's `expiresAt` is compared against it, so a millisecond clock makes
   * every proposal look expired and kills every approval. Defaults to
   * `Math.floor(Date.now() / 1000)`.
   */
  now?: () => number;
}
/**
 * In-memory reference implementation.
 *
 * Correct for a single instance, and the semantics every other backend must
 * reproduce — but it is *not* durable: it is lost on restart and not shared
 * across replicas. Use it in tests, in development, and in single-instance
 * deployments; back a multi-replica deployment with a store that has
 * conditional writes.
 */
declare function createMemoryApprovalStore(options?: MemoryApprovalStoreOptions): CapabilityApprovalStore;
/**
 * Parameter placeholder style. `"sqlite"` emits `?` (SQLite, Turso/libSQL,
 * Cloudflare D1); `"postgres"` emits `$1`, `$2`, … (node-postgres, Neon,
 * Supabase).
 */
type SqlApprovalStoreDialect = "sqlite" | "postgres";
/**
 * Whatever the driver returns from a parameterized statement. Every shape the
 * mainstream drivers produce is accepted, so `execute` can usually be a
 * one-liner around the driver call:
 *
 * - `pg`: `{ rows, rowCount }`
 * - Cloudflare D1 (`.all()`): `{ results, meta: { changes } }`
 * - `better-sqlite3` / `node:sqlite`: `{ changes }` from `run()`, an array from `all()`
 * - libSQL / Turso: `{ rows, rowsAffected }`
 *
 * A bare array is read as rows with no affected-row count — fine for reads,
 * but the conditional writes need the count, so the store throws rather than
 * guessing that a write succeeded.
 */
interface SqlApprovalStoreResult {
  rows?: readonly unknown[];
  /** Cloudflare D1 names the row array `results`. */
  results?: readonly unknown[];
  rowsAffected?: number;
  /** node-postgres. */
  rowCount?: number | null;
  /** better-sqlite3, node:sqlite. */
  changes?: number | bigint;
  /**
   * Cloudflare D1. Only `changes` is read: `rows_written` is billing-page
   * accounting (index pages touched), not the number of rows a statement
   * matched, so treating it as an affected-row count would report success for
   * a conditional update that changed nothing.
   */
  meta?: {
    changes?: number;
  };
}
/**
 * Run one parameterized statement. Supplied by the application, so the store
 * needs no driver dependency and works on every runtime.
 */
type SqlApprovalStoreExecute = (sql: string, params: unknown[]) => Promise<SqlApprovalStoreResult | readonly unknown[] | null | undefined>;
interface SqlApprovalStoreOptions {
  /** Parameterized-query function; see {@link SqlApprovalStoreExecute}. */
  execute: SqlApprovalStoreExecute;
  /** Placeholder style. Default `"sqlite"` (`?`). */
  dialect?: SqlApprovalStoreDialect;
  /**
   * Table holding proposals. Default `"pracht_approvals"`. Interpolated into
   * SQL (identifiers cannot be parameters), so it must be a plain identifier
   * or `schema.identifier`; anything else throws at construction.
   */
  table?: string;
  /**
   * Clock override. MUST return **unix seconds**, not milliseconds — every
   * record's `expiresAt` is compared against it, so a millisecond clock makes
   * every proposal look expired and kills every approval. Defaults to
   * `Math.floor(Date.now() / 1000)`.
   */
  now?: () => number;
  /**
   * Minimum seconds between opportunistic `DELETE`s of expired rows. Default
   * 60; `0` sweeps on every proposal. Expiry is always enforced by the
   * statements themselves — the sweep only reclaims space.
   */
  sweepIntervalSeconds?: number;
}
/**
 * Durable approvals over any SQL database, with no driver dependency: pass an
 * `execute(sql, params)` and the store speaks the portable subset that
 * Postgres, SQLite/Turso, and Cloudflare D1 all implement.
 *
 * The two hard requirements of {@link CapabilityApprovalStore} are enforced by
 * the database, not by this code:
 *
 * - `create()` is `INSERT … ON CONFLICT (id) DO UPDATE … WHERE expires_at < now`,
 *   so a live proposal is never overwritten by a concurrent re-prepare; the
 *   conflicting row is read back and returned unchanged.
 * - `consume()` is a single conditional `UPDATE` whose `WHERE` clause carries
 *   the whole eligibility rule (unexpired, not already consumed or rejected,
 *   and approved when the *stored* `requires_approval` says so). Exactly one of
 *   two concurrent commits can affect a row, so exactly one gets `ok: true`.
 *
 * Nothing here uses `RETURNING`: D1 and SQLite before 3.35 do not support it
 * consistently, so the store relies on the affected-row count every driver
 * reports instead. See docs/AGENT_TRUST.md for the table schema, the migration,
 * and per-backend wiring snippets.
 */
declare function createSqlApprovalStore(options: SqlApprovalStoreOptions): CapabilityApprovalStore;
//#endregion
export { MemoryApprovalStoreOptions, SqlApprovalStoreDialect, SqlApprovalStoreExecute, SqlApprovalStoreOptions, SqlApprovalStoreResult, createMemoryApprovalStore, createSqlApprovalStore, setCapabilityApprovalPrincipalResolver, setCapabilityApprovalStore };