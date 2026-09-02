import { hmacSha256Base64Url } from "./runtime-confirmation.mjs";
//#region src/runtime-approval.ts
/**
* Durable approvals for destructive capabilities.
*
* The stateless prepare/commit flow in runtime-confirmation.ts proves that a
* commit is bound to one principal, one capability, and one exact input. Two
* things it cannot prove on its own:
*
*   1. that the token is used only once — an HMAC is verifiable anywhere, so
*      a captured token replays until it expires, on any replica;
*   2. that a *person* agreed — the calling agent receives the token and can
*      immediately hand it back to itself.
*
* Registering a {@link CapabilityApprovalStore} closes the replay gap. Prepare
* records a proposal; commit verifies the HMAC first (so a forged token can
* never burn a real proposal) and then asks the store to consume it exactly
* once. Human mode additionally requires an authenticated principal from Web
* Bot Auth or `setCapabilityApprovalPrincipalResolver()` before an out-of-band
* decision can authorize the operation.
*
* The caller interaction does not change: callers still just echo the
* confirmation token they were handed. Store-backed tokens use a distinct
* version and bind the approval mode so older or differently configured
* replicas reject them instead of bypassing the store.
*/
let approvalStore = null;
let approvalPrincipalResolver = null;
/**
* Register the store backing destructive-capability approvals. Call it from a
* server-only module (a capability module, middleware applied to the
* capability/API chain, or a custom server entry). Passing `null` unregisters.
*/
function setCapabilityApprovalStore(store) {
	approvalStore = store;
}
function resolveCapabilityApprovalStore() {
	return approvalStore;
}
/**
* Register a server-only resolver for the application-authenticated identity
* bound to approval proposals. Human approval without either this identity or
* a verified agent identity fails closed.
*/
function setCapabilityApprovalPrincipalResolver(resolver) {
	approvalPrincipalResolver = resolver;
}
/**
* Whether an application principal resolver exists at all. Used by serve-time
* precondition checks — it says a principal is *possible*, never that one was
* resolved for a given request.
*/
function hasCapabilityApprovalPrincipalResolver() {
	return approvalPrincipalResolver !== null;
}
async function resolveCapabilityApprovalPrincipal(options) {
	const applicationPrincipal = approvalPrincipalResolver ? await approvalPrincipalResolver({
		...options,
		context: options.context
	}) : null;
	if (applicationPrincipal !== null && (typeof applicationPrincipal !== "string" || applicationPrincipal.trim() === "")) throw new Error("the approval principal resolver must return a non-empty string or null");
	const parts = [];
	if (options.agent) parts.push(`agent:${options.agent.keyId}`);
	if (applicationPrincipal) parts.push(`app:${applicationPrincipal}`);
	if (parts.length === 0) return null;
	if (options.agent && !applicationPrincipal) return {
		record: parts[0],
		tokenBinding: parts[0]
	};
	const record = JSON.stringify(parts);
	return {
		record,
		tokenBinding: `approval:${await hmacSha256Base64Url(options.confirmationSecret, record)}`
	};
}
/**
* The proposal id for one destructive operation: a secret-keyed digest over
* the principal, capability name, input hash, and approval mode. Deriving it
* means two prepare calls for the same operation address the same proposal,
* while keying it keeps caller-visible ids from revealing low-entropy
* application principals through offline guessing.
*/
async function capabilityApprovalId(confirmationSecret, principal, capability, inputHash, approvalMode) {
	return hmacSha256Base64Url(confirmationSecret, `pracht-approval-id:${JSON.stringify([
		principal,
		capability,
		inputHash,
		approvalMode
	])}`);
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
function createMemoryApprovalStore(options = {}) {
	const now = options.now ?? (() => Math.floor(Date.now() / 1e3));
	const records = /* @__PURE__ */ new Map();
	const cloneRecord = (record) => structuredClone(record);
	const sweep = (timestamp) => {
		for (const [id, record] of records) if (record.expiresAt < timestamp) records.delete(id);
	};
	return {
		async create(record) {
			const timestamp = now();
			sweep(timestamp);
			const existing = records.get(record.id);
			if (existing && existing.expiresAt >= timestamp) return cloneRecord(existing);
			const stored = cloneRecord(record);
			records.set(stored.id, stored);
			return cloneRecord(stored);
		},
		async get(id) {
			const record = records.get(id);
			return record ? cloneRecord(record) : null;
		},
		async listPending() {
			const timestamp = now();
			return [...records.values()].filter((record) => record.state === "pending" && record.expiresAt >= timestamp).map(cloneRecord);
		},
		async decide(id, decision, by) {
			const timestamp = now();
			const record = records.get(id);
			if (!record || record.state !== "pending" || record.expiresAt < timestamp) return false;
			records.set(id, {
				...record,
				state: decision,
				decidedBy: by,
				decidedAt: timestamp
			});
			return true;
		},
		async consume(id) {
			const timestamp = now();
			const record = records.get(id);
			if (!record) return {
				ok: false,
				reason: "unknown"
			};
			if (record.expiresAt < timestamp) {
				records.delete(id);
				return {
					ok: false,
					reason: "expired"
				};
			}
			if (record.state === "consumed") return {
				ok: false,
				reason: "already_used"
			};
			if (record.state === "rejected") return {
				ok: false,
				reason: "rejected"
			};
			if (record.requiresApproval && record.state !== "approved") return {
				ok: false,
				reason: "awaiting_approval"
			};
			const consumed = {
				...record,
				state: "consumed"
			};
			records.set(id, consumed);
			return {
				ok: true,
				record: cloneRecord(consumed)
			};
		}
	};
}
const SQL_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const APPROVAL_COLUMNS = "id, principal, capability, input_hash, input, requires_approval, created_at, expires_at, state, decided_by, decided_at";
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
function createSqlApprovalStore(options) {
	const { execute } = options;
	if (typeof execute !== "function") throw new Error("createSqlApprovalStore({ execute }) requires an execute function.");
	const table = options.table ?? "pracht_approvals";
	const segments = table.split(".");
	if (segments.length > 2 || !segments.every((segment) => SQL_IDENTIFIER_RE.test(segment))) throw new Error(`createSqlApprovalStore({ table }) must be a plain SQL identifier or "schema.identifier", got ${JSON.stringify(table)}.`);
	const quoteIdentifier = (identifier) => `"${identifier}"`;
	const tableSql = segments.map(quoteIdentifier).join(".");
	const tableRef = quoteIdentifier(segments[segments.length - 1]);
	const dialect = options.dialect ?? "sqlite";
	if (dialect !== "sqlite" && dialect !== "postgres") throw new Error(`createSqlApprovalStore({ dialect }) must be "sqlite" or "postgres", got ${JSON.stringify(dialect)}.`);
	const now = options.now ?? (() => Math.floor(Date.now() / 1e3));
	const sweepIntervalSeconds = options.sweepIntervalSeconds ?? 60;
	let nextSweepAt = 0;
	/** Placeholders are 1-based and positional; SQLite ignores the number. */
	const p = (index) => dialect === "postgres" ? `$${index}` : "?";
	const list = (count, from = 1) => Array.from({ length: count }, (_, offset) => p(from + offset)).join(", ");
	const updatedColumns = [
		"principal",
		"capability",
		"input_hash",
		"input",
		"requires_approval",
		"created_at",
		"expires_at",
		"state",
		"decided_by",
		"decided_at"
	].map((column) => `${column} = excluded.${column}`).join(", ");
	const CREATE_SQL = `INSERT INTO ${tableSql} (${APPROVAL_COLUMNS}) VALUES (${list(11)}) ON CONFLICT (id) DO UPDATE SET ${updatedColumns} WHERE ${tableRef}.expires_at < ${p(12)}`;
	const SELECT_SQL = `SELECT ${APPROVAL_COLUMNS} FROM ${tableSql} WHERE id = ${p(1)}`;
	const LIST_PENDING_SQL = `SELECT ${APPROVAL_COLUMNS} FROM ${tableSql} WHERE state = 'pending' AND expires_at >= ${p(1)} ORDER BY created_at ASC, id ASC`;
	const DECIDE_SQL = `UPDATE ${tableSql} SET state = ${p(1)}, decided_by = ${p(2)}, decided_at = ${p(3)} WHERE id = ${p(4)} AND state = 'pending' AND expires_at >= ${p(5)}`;
	const CONSUME_SQL = `UPDATE ${tableSql} SET state = 'consumed' WHERE id = ${p(1)} AND expires_at >= ${p(2)} AND ((requires_approval = 0 AND state IN ('pending', 'approved')) OR (requires_approval = 1 AND state = 'approved'))`;
	const DELETE_SQL = `DELETE FROM ${tableSql} WHERE id = ${p(1)}`;
	const SWEEP_SQL = `DELETE FROM ${tableSql} WHERE expires_at < ${p(1)}`;
	const run = async (sql, params) => {
		const result = await execute(sql, params);
		if (Array.isArray(result)) return { rows: result };
		return result ?? {};
	};
	const readRows = (result) => result.rows ?? result.results ?? [];
	const readAffected = (result, sql) => {
		const candidate = result.rowsAffected ?? (typeof result.rowCount === "number" ? result.rowCount : void 0) ?? (typeof result.changes === "bigint" ? Number(result.changes) : result.changes) ?? result.meta?.changes;
		if (typeof candidate !== "number" || !Number.isFinite(candidate)) throw new Error(`createSqlApprovalStore(): execute() must report how many rows a write affected (return the driver result, or \`{ rowsAffected }\`) — the store's exactly-once guarantee is that count. Statement: ${sql}`);
		return candidate;
	};
	const selectRecord = async (id) => {
		const row = readRows(await run(SELECT_SQL, [id]))[0];
		return row ? rowToRecord(row) : null;
	};
	const sweep = async (timestamp) => {
		if (timestamp < nextSweepAt) return;
		nextSweepAt = timestamp + sweepIntervalSeconds;
		await run(SWEEP_SQL, [timestamp]);
	};
	return {
		async create(record) {
			const timestamp = now();
			await sweep(timestamp);
			const params = [
				record.id,
				record.principal,
				record.capability,
				record.inputHash,
				JSON.stringify(record.input ?? null),
				record.requiresApproval ? 1 : 0,
				record.createdAt,
				record.expiresAt,
				record.state,
				record.decidedBy,
				record.decidedAt,
				timestamp
			];
			for (let attempt = 0; attempt < 2; attempt += 1) {
				if (readAffected(await run(CREATE_SQL, params), CREATE_SQL) > 0) return record;
				const existing = await selectRecord(record.id);
				if (existing) return existing;
			}
			throw new Error(`createSqlApprovalStore(): proposal ${JSON.stringify(record.id)} could not be created and no conflicting row was found.`);
		},
		async get(id) {
			return selectRecord(id);
		},
		async listPending() {
			return readRows(await run(LIST_PENDING_SQL, [now()])).map(rowToRecord);
		},
		async decide(id, decision, by) {
			const timestamp = now();
			return readAffected(await run(DECIDE_SQL, [
				decision,
				by,
				timestamp,
				id,
				timestamp
			]), DECIDE_SQL) === 1;
		},
		async consume(id) {
			const timestamp = now();
			if (readAffected(await run(CONSUME_SQL, [id, timestamp]), CONSUME_SQL) === 1) {
				const consumed = await selectRecord(id);
				if (!consumed) return {
					ok: false,
					reason: "expired"
				};
				return {
					ok: true,
					record: {
						...consumed,
						state: "consumed"
					}
				};
			}
			const record = await selectRecord(id);
			if (!record) return {
				ok: false,
				reason: "unknown"
			};
			if (record.expiresAt < timestamp) {
				await run(DELETE_SQL, [id]);
				return {
					ok: false,
					reason: "expired"
				};
			}
			if (record.state === "consumed") return {
				ok: false,
				reason: "already_used"
			};
			if (record.state === "rejected") return {
				ok: false,
				reason: "rejected"
			};
			return {
				ok: false,
				reason: "awaiting_approval"
			};
		}
	};
}
/**
* Drivers disagree about column-name casing, integer representation, and
* whether JSON columns arrive parsed. Normalize defensively so one store works
* across `pg`, D1, libSQL, and better-sqlite3 without per-backend adapters.
*/
function rowToRecord(row) {
	if (!row || typeof row !== "object") throw new Error("createSqlApprovalStore(): execute() must return rows as objects.");
	const source = row;
	const read = (snake, camel) => source[snake] !== void 0 ? source[snake] : source[camel];
	return {
		id: String(read("id", "id")),
		principal: String(read("principal", "principal")),
		capability: String(read("capability", "capability")),
		inputHash: String(read("input_hash", "inputHash")),
		input: parseStoredInput(read("input", "input")),
		requiresApproval: toBoolean(read("requires_approval", "requiresApproval")),
		createdAt: toSeconds(read("created_at", "createdAt")),
		expiresAt: toSeconds(read("expires_at", "expiresAt")),
		state: String(read("state", "state")),
		decidedBy: nullableString(read("decided_by", "decidedBy")),
		decidedAt: nullableSeconds(read("decided_at", "decidedAt"))
	};
}
function parseStoredInput(value) {
	if (typeof value !== "string") return value ?? null;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
function toBoolean(value) {
	if (typeof value === "boolean") return value;
	if (typeof value === "bigint") return value !== 0n;
	if (typeof value === "number") return value !== 0;
	return value === "1" || value === "true" || value === "t";
}
/** BIGINT arrives as a string from `pg` and as a bigint from some SQLite modes. */
function toSeconds(value) {
	const parsed = typeof value === "bigint" ? Number(value) : Number(value);
	if (!Number.isFinite(parsed)) throw new Error(`createSqlApprovalStore(): expected a unix-seconds integer, got ${JSON.stringify(value)}.`);
	return parsed;
}
function nullableSeconds(value) {
	return value === null || value === void 0 ? null : toSeconds(value);
}
function nullableString(value) {
	return value === null || value === void 0 ? null : String(value);
}
//#endregion
export { capabilityApprovalId, createMemoryApprovalStore, createSqlApprovalStore, hasCapabilityApprovalPrincipalResolver, resolveCapabilityApprovalPrincipal, resolveCapabilityApprovalStore, setCapabilityApprovalPrincipalResolver, setCapabilityApprovalStore };
