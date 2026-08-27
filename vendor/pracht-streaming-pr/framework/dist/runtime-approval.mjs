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
* server-only module (a capability module, middleware, or a custom server
* entry). Passing `null` unregisters.
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
//#endregion
export { capabilityApprovalId, createMemoryApprovalStore, resolveCapabilityApprovalPrincipal, resolveCapabilityApprovalStore, setCapabilityApprovalPrincipalResolver, setCapabilityApprovalStore };
