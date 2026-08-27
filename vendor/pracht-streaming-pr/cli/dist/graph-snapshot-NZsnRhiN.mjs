import { a as formatBytes } from "./bundle-report-lW_Uk3V5.mjs";
import { i as createSourceReader, n as capabilityModuleLoader, t as withAppServer } from "./app-server-Bd0VAe05.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveMcpEndpoint, serializeApiRoutes, serializeAppRoutes, serializeCapabilities } from "@pracht/core";
import { execFileSync } from "node:child_process";
//#region src/graph-snapshot.ts
/**
* The app-graph snapshot is a committed, canonical serialization of the
* resolved route graph (`.pracht/app-graph.json`) — a route-graph lockfile.
* `pracht plan` diffs the live graph against the snapshot at a base git ref
* to produce an intent-level changelog, and `pracht verify` fails when the
* snapshot is stale, so the committed snapshot is always trustworthy.
*/
const GRAPH_SNAPSHOT_PATH = ".pracht/app-graph.json";
async function resolveLiveGraphMetadata(root) {
	return withAppServer(root, async ({ project, server, serverModule }) => {
		const resolvedRoutes = serverModule.resolvedApp.routes;
		const routes = serializeAppRoutes(resolvedRoutes);
		const api = await serializeApiRoutes(serverModule.apiRoutes, {
			loadModule: (file) => server.ssrLoadModule(file),
			readSource: (file) => readFileSync(resolve(root, `.${file}`), "utf-8")
		}, { strict: true });
		const capabilities = await serializeCapabilities(serverModule.resolvedApp.capabilities, {
			loadModule: capabilityModuleLoader(server, serverModule),
			readSource: createSourceReader(root, project.appFile)
		}, { strict: true });
		return {
			graph: normalizeGraphSnapshot({
				prachtGraphVersion: 1,
				mode: project.mode,
				routes,
				api,
				capabilities,
				mcpEndpoint: resolveMcpEndpoint(serverModule.resolvedApp.agents),
				constraints: serverModule.resolvedApp.constraints ?? []
			}),
			loaderRoutePaths: new Set(resolvedRoutes.filter((route) => route.loaderFile !== void 0 || route.hasLoader !== false).map((route) => route.path)),
			staticTarget: serverModule.staticTarget === true
		};
	});
}
async function resolveLiveGraph(root) {
	return (await resolveLiveGraphMetadata(root)).graph;
}
/**
* Strip the diagnostic `error` field before a capability enters the committed
* snapshot.
*
* The snapshot is compared byte-for-byte against `.pracht/app-graph.json` to
* decide staleness, so serializing a new field would mark every committed
* snapshot stale on upgrade with no real graph change. It also has no business
* being committed: it is a local wiring failure, not app shape, and its message
* carries absolute machine paths. It stays available on `pracht inspect
* capabilities` and the dev banner, where it is actionable.
*/
function withoutLoadError(capability) {
	if (capability.error == null) return capability;
	const { error: _error, ...rest } = capability;
	return rest;
}
/** Stable ordering + JSON round-trip so snapshots diff cleanly in git. */
function normalizeGraphSnapshot(snapshot) {
	const normalized = {
		prachtGraphVersion: snapshot.prachtGraphVersion,
		mode: snapshot.mode,
		routes: snapshot.routes.map((route) => ({
			...route,
			streaming: route.streaming ?? null
		})).sort((left, right) => left.path.localeCompare(right.path)),
		api: [...snapshot.api].sort((left, right) => left.path.localeCompare(right.path)),
		capabilities: [...snapshot.capabilities ?? []].sort((left, right) => left.name.localeCompare(right.name)),
		mcpEndpoint: snapshot.mcpEndpoint ?? null,
		constraints: snapshot.constraints ?? []
	};
	return JSON.parse(JSON.stringify(normalized));
}
function serializeGraphSnapshot(snapshot) {
	const normalized = normalizeGraphSnapshot(snapshot);
	return `${JSON.stringify({
		...normalized,
		capabilities: normalized.capabilities.map(withoutLoadError)
	}, null, 2)}\n`;
}
function writeGraphSnapshot(root, snapshot) {
	const filePath = resolve(root, GRAPH_SNAPSHOT_PATH);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, serializeGraphSnapshot(snapshot), "utf-8");
	return filePath;
}
function readGraphSnapshotFromDisk(root) {
	const filePath = resolve(root, GRAPH_SNAPSHOT_PATH);
	if (!existsSync(filePath)) return null;
	return parseSnapshot(readFileSync(filePath, "utf-8"));
}
function runGit(root, args) {
	try {
		return execFileSync("git", [
			"-C",
			root,
			...args
		], {
			encoding: "utf-8",
			stdio: [
				"ignore",
				"pipe",
				"ignore"
			]
		});
	} catch {
		return null;
	}
}
/** Read the committed snapshot at a git ref, reporting *why* it is absent. */
function resolveBaseSnapshot(root, ref) {
	const prefix = runGit(root, ["rev-parse", "--show-prefix"]);
	if (prefix === null) return {
		status: "not-a-repo",
		snapshot: null
	};
	if (runGit(root, [
		"rev-parse",
		"--verify",
		"--quiet",
		`${ref}^{commit}`
	]) === null) return {
		status: "missing-ref",
		snapshot: null
	};
	const contents = runGit(root, ["show", `${ref}:${prefix.trim()}${GRAPH_SNAPSHOT_PATH}`]);
	if (contents === null) return {
		status: "no-snapshot",
		snapshot: null
	};
	const snapshot = parseSnapshot(contents);
	return snapshot ? {
		status: "ok",
		snapshot
	} : {
		status: "no-snapshot",
		snapshot: null
	};
}
function parseSnapshot(contents) {
	try {
		const parsed = JSON.parse(contents);
		if (!parsed || !Array.isArray(parsed.routes) || !Array.isArray(parsed.api)) return null;
		return {
			prachtGraphVersion: parsed.prachtGraphVersion ?? 1,
			mode: parsed.mode ?? "manifest",
			routes: parsed.routes,
			api: parsed.api,
			capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : [],
			mcpEndpoint: typeof parsed.mcpEndpoint === "string" ? parsed.mcpEndpoint : null,
			constraints: Array.isArray(parsed.constraints) ? parsed.constraints : []
		};
	} catch {
		return null;
	}
}
const ROUTE_DIFF_FIELDS = [
	"render",
	"hydration",
	"shell",
	"middleware",
	"file",
	"loaderFile",
	"loaderCache",
	"streaming",
	"markdown",
	"revalidate",
	"id"
];
function diffGraphSnapshots(base, head) {
	const routeDiff = diffByPath(base.routes, head.routes, (left, right) => collectFieldChanges(left, right, ROUTE_DIFF_FIELDS));
	const apiDiff = diffByPath(base.api, head.api, (left, right) => collectFieldChanges(left, right, ["methods", "file"]));
	const baseConstraints = new Set(base.constraints.map((entry) => JSON.stringify(entry)));
	const headConstraints = new Set(head.constraints.map((entry) => JSON.stringify(entry)));
	const addedConstraints = head.constraints.filter((entry) => !baseConstraints.has(JSON.stringify(entry)));
	const removedConstraints = base.constraints.filter((entry) => !headConstraints.has(JSON.stringify(entry)));
	const capabilityChanges = diffCapabilities(base.capabilities ?? [], head.capabilities ?? []);
	const baseMcpEndpoint = base.mcpEndpoint ?? null;
	const headMcpEndpoint = head.mcpEndpoint ?? null;
	const mcpEndpointChange = baseMcpEndpoint === headMcpEndpoint ? null : {
		field: "mcpEndpoint",
		from: baseMcpEndpoint,
		to: headMcpEndpoint
	};
	const identical = routeDiff.added.length === 0 && routeDiff.removed.length === 0 && routeDiff.changed.length === 0 && apiDiff.added.length === 0 && apiDiff.removed.length === 0 && apiDiff.changed.length === 0 && addedConstraints.length === 0 && removedConstraints.length === 0 && mcpEndpointChange === null && capabilityChanges.length === 0;
	return {
		addedApi: apiDiff.added,
		addedConstraints,
		addedRoutes: routeDiff.added,
		capabilityChanges,
		changedApi: apiDiff.changed,
		changedRoutes: routeDiff.changed,
		identical,
		mcpEndpointChange,
		removedApi: apiDiff.removed,
		removedConstraints,
		removedRoutes: routeDiff.removed,
		widensAgentSurface: capabilityChanges.some((change) => change.severity === "warn") || baseMcpEndpoint === null && headMcpEndpoint !== null
	};
}
const AGENT_TRANSPORTS = new Set(["mcp", "webmcp"]);
/**
* Capability changes, classified by whether they widen the agent-reachable
* surface. Registration, exposure, effect class, policy, middleware, and the
* input schema all decide what an agent may do — and all of them are easy to
* change without any visible route diff.
*/
function diffCapabilities(base, head) {
	const baseByName = new Map(base.map((entry) => [entry.name, entry]));
	const headByName = new Map(head.map((entry) => [entry.name, entry]));
	const changes = [];
	for (const entry of head) {
		if (baseByName.has(entry.name)) continue;
		const exposed = entry.transports.length > 0;
		changes.push({
			kind: "added",
			capability: entry.name,
			severity: exposed ? "warn" : "info",
			detail: exposed ? `new ${entry.effect ?? "?"} capability exposed via ${entry.transports.join(", ")}` : `new private ${entry.effect ?? "?"} capability`
		});
	}
	for (const entry of base) {
		if (headByName.has(entry.name)) continue;
		changes.push({
			kind: "removed",
			capability: entry.name,
			severity: "info",
			detail: `removed (was ${entry.transports.join(", ") || "private"})`
		});
	}
	for (const entry of head) {
		const previous = baseByName.get(entry.name);
		if (previous) changes.push(...diffCapability(previous, entry));
	}
	return changes.sort((left, right) => Number(right.severity === "warn") - Number(left.severity === "warn") || left.capability.localeCompare(right.capability));
}
function diffCapability(base, head) {
	const changes = [];
	const capability = head.name;
	const addedTransports = head.transports.filter((transport) => !base.transports.includes(transport));
	const removedTransports = base.transports.filter((transport) => !head.transports.includes(transport));
	if (addedTransports.length > 0) changes.push({
		kind: "exposure-added",
		capability,
		severity: "warn",
		detail: `now exposed via ${addedTransports.join(", ")}${addedTransports.some((transport) => AGENT_TRANSPORTS.has(transport)) ? " — reachable by agents" : ""}`
	});
	if (removedTransports.length > 0) changes.push({
		kind: "exposure-removed",
		capability,
		severity: "info",
		detail: `no longer exposed via ${removedTransports.join(", ")}`
	});
	if (base.effect !== head.effect) changes.push({
		kind: "effect-changed",
		capability,
		severity: base.effect === "destructive" ? "warn" : "info",
		detail: `effect ${base.effect ?? "none"} → ${head.effect ?? "none"}`
	});
	const guardsUnverified = Boolean(base.unverifiedContract || head.unverifiedContract);
	const basePolicy = base.agentPolicy ?? null;
	const headPolicy = head.agentPolicy ?? null;
	if (!guardsUnverified && basePolicy !== headPolicy) {
		const weakened = basePolicy === "require" && headPolicy !== "require";
		changes.push({
			kind: weakened ? "policy-weakened" : "policy-strengthened",
			capability,
			severity: weakened ? "warn" : "info",
			detail: `agentPolicy ${basePolicy ?? "(app default)"} → ${headPolicy ?? "(app default)"}`
		});
	}
	const droppedMiddleware = base.middleware.filter((name) => !head.middleware.includes(name));
	const addedMiddleware = head.middleware.filter((name) => !base.middleware.includes(name));
	if (!guardsUnverified && droppedMiddleware.length > 0) changes.push({
		kind: "middleware-removed",
		capability,
		severity: "warn",
		detail: `middleware removed: ${droppedMiddleware.join(", ")}`
	});
	if (!guardsUnverified && addedMiddleware.length > 0) changes.push({
		kind: "middleware-added",
		capability,
		severity: "info",
		detail: `middleware added: ${addedMiddleware.join(", ")}`
	});
	if (base.httpPath && head.httpPath && base.httpPath !== head.httpPath) changes.push({
		kind: "path-changed",
		capability,
		severity: "info",
		detail: `HTTP path ${base.httpPath} → ${head.httpPath}`
	});
	for (const detail of schemaWidenings(base.input, head.input)) changes.push({
		kind: "input-widened",
		capability,
		severity: "warn",
		detail
	});
	if (JSON.stringify(base.output) !== JSON.stringify(head.output)) changes.push({
		kind: "output-changed",
		capability,
		severity: "info",
		detail: "output schema changed — check what agents can now read"
	});
	if (guardsUnverified && changes.length > 0) changes.push({
		kind: "contract-unverified",
		capability,
		severity: "info",
		detail: "agentPolicy and middleware could not be read statically (the module does not load outside its deploy runtime), so changes to them are not reflected above — review by hand"
	});
	return changes;
}
/**
* Structural widenings of an input schema. Accepting more than before is the
* schema equivalent of loosening a guard, and it disappears into a line diff
* as soon as a schema is more than a few lines long.
*/
function schemaWidenings(base, head, path = "") {
	if (!base || !head) return [];
	const label = path || "input";
	const reasons = [];
	const noLongerRequired = stringArray(base.required).filter((key) => !stringArray(head.required).includes(key));
	if (noLongerRequired.length > 0) reasons.push(`${label}: no longer requires ${noLongerRequired.join(", ")}`);
	if (base.additionalProperties === false && head.additionalProperties !== false) reasons.push(`${label}: additionalProperties opened up`);
	const baseEnum = stringArray(base.enum);
	if (baseEnum.length > 0 && stringArray(head.enum).some((value) => !baseEnum.includes(value))) reasons.push(`${label}: enum widened`);
	for (const keyword of ["maximum", "maxLength"]) {
		const before = base[keyword];
		const after = head[keyword];
		if (typeof before === "number" && (after === void 0 || typeof after === "number" && after > before)) reasons.push(`${label}: ${keyword} raised (${before} → ${after ?? "unbounded"})`);
	}
	for (const keyword of ["minimum", "minLength"]) {
		const before = base[keyword];
		const after = head[keyword];
		if (typeof before === "number" && (after === void 0 || typeof after === "number" && after < before)) reasons.push(`${label}: ${keyword} lowered (${before} → ${after ?? "unbounded"})`);
	}
	const baseProperties = asRecord(base.properties);
	for (const [key, headSchema] of Object.entries(asRecord(head.properties))) {
		const baseSchema = baseProperties[key];
		if (baseSchema) reasons.push(...schemaWidenings(asRecord(baseSchema), asRecord(headSchema), `${label}.${key}`));
	}
	return reasons;
}
function stringArray(value) {
	return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}
function asRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function diffByPath(base, head, compare) {
	const baseByPath = new Map(base.map((entry) => [entry.path, entry]));
	const headByPath = new Map(head.map((entry) => [entry.path, entry]));
	const added = head.filter((entry) => !baseByPath.has(entry.path));
	const removed = base.filter((entry) => !headByPath.has(entry.path));
	const changed = [];
	for (const entry of head) {
		const baseEntry = baseByPath.get(entry.path);
		if (!baseEntry) continue;
		const changes = compare(baseEntry, entry);
		if (changes.length > 0) changed.push({
			path: entry.path,
			changes
		});
	}
	return {
		added,
		changed,
		removed
	};
}
function collectFieldChanges(base, head, fields) {
	const changes = [];
	for (const field of fields) {
		const from = base[field] ?? null;
		const to = head[field] ?? null;
		if (JSON.stringify(from) !== JSON.stringify(to)) changes.push({
			field,
			from,
			to
		});
	}
	return changes;
}
/** Per-route gzip sizes from the last `pracht build`, when budgets are configured. */
function readRouteBudgets(root) {
	const budgets = /* @__PURE__ */ new Map();
	const reportPath = resolve(root, "dist/server/budget-report.json");
	if (!existsSync(reportPath)) return budgets;
	try {
		const report = JSON.parse(readFileSync(reportPath, "utf-8"));
		for (const result of report.results ?? []) budgets.set(result.path, {
			gzipBytes: result.gzipBytes,
			limitBytes: result.limitBytes,
			ok: result.ok
		});
	} catch {}
	return budgets;
}
function formatPlanLines(diff, options) {
	const budgets = options.budgets ?? /* @__PURE__ */ new Map();
	const lines = [];
	for (const route of diff.addedRoutes) lines.push(`+ route ${route.path}  ${describeRoute(route)}${budgetSuffix(budgets, route.path)}`);
	for (const entry of diff.changedRoutes) lines.push(`~ route ${entry.path}  ${entry.changes.map(formatFieldChange).join(", ")}${budgetSuffix(budgets, entry.path)}`);
	for (const route of diff.removedRoutes) lines.push(`- route ${route.path}`);
	for (const api of diff.addedApi) lines.push(`+ api   ${api.path}  methods=[${api.methods.join(", ")}]`);
	for (const entry of diff.changedApi) lines.push(`~ api   ${entry.path}  ${entry.changes.map(formatFieldChange).join(", ")}`);
	for (const api of diff.removedApi) lines.push(`- api   ${api.path}`);
	if (diff.mcpEndpointChange) lines.push(formatMcpEndpointChange(diff.mcpEndpointChange));
	for (const change of diff.capabilityChanges) lines.push(`${capabilityChangeMarker(change)} capability ${change.capability}  ${change.detail}`);
	for (const constraint of diff.addedConstraints) lines.push(`+ constraint ${describeConstraint(constraint)}`);
	for (const constraint of diff.removedConstraints) lines.push(`- constraint ${describeConstraint(constraint)}`);
	return lines;
}
/**
* Diff-block prefix. `!` marks a widening so it reads as a warning in the
* rendered diff rather than blending into ordinary additions.
*/
function capabilityChangeMarker(change) {
	if (change.severity === "warn") return "!";
	if (change.kind === "added") return "+";
	if (change.kind === "removed") return "-";
	return "~";
}
function formatMcpEndpointChange(change) {
	const from = typeof change.from === "string" ? change.from : null;
	const to = typeof change.to === "string" ? change.to : null;
	if (!from && to) return `! mcp endpoint ${to} enabled — declared MCP capabilities are now reachable by agents`;
	if (from && !to) return `- mcp endpoint ${from} disabled`;
	return `~ mcp endpoint ${from} → ${to}`;
}
function formatPlanText(diff, options) {
	const header = options.base ? `Pracht plan (base: ${options.base})` : "Pracht plan (no baseline snapshot — every entry shows as added)";
	const lines = formatPlanLines(diff, options);
	if (diff.identical) return `${header}\n\nNo app graph changes.`;
	const footer = diff.widensAgentSurface ? "\n\nThis change widens what agents can reach or weakens a guard (! lines)." : "";
	return `${header}\n\n${lines.join("\n")}${footer}`;
}
function formatPlanMarkdown(diff, options) {
	const heading = options.base ? `### App graph changes (base: \`${options.base}\`)` : "### App graph (no baseline snapshot at the base ref)";
	if (diff.identical) return `${heading}\n\nNo app graph changes.`;
	const lines = formatPlanLines(diff, options);
	const summary = [
		countLabel(diff.addedRoutes.length + diff.addedApi.length, "added"),
		countLabel(diff.changedRoutes.length + diff.changedApi.length, "changed"),
		countLabel(diff.removedRoutes.length + diff.removedApi.length, "removed"),
		countLabel(diff.mcpEndpointChange ? 1 : 0, "MCP endpoint change"),
		countLabel(diff.capabilityChanges.length, "capability change")
	].filter(Boolean).join(", ");
	const warning = diff.widensAgentSurface ? "> ⚠️ **This change widens what agents can reach or weakens a guard.**" : "";
	return [
		heading,
		"",
		summary ? `${summary}.` : "",
		warning,
		"```diff",
		...lines,
		"```"
	].filter((line, index) => line !== "" || index === 1).join("\n");
}
function describeRoute(route) {
	const parts = [`render=${route.render ?? "default"}`];
	if (route.hydration) parts.push(`hydration=${route.hydration}`);
	if (route.streaming) parts.push("streaming=true");
	parts.push(`shell=${route.shell ?? "none"}`);
	parts.push(`middleware=[${route.middleware.join(", ")}]`);
	if (route.markdown) parts.push("markdown=true");
	if (route.loaderFile) parts.push(`loader=${route.loaderFile}`);
	if (route.revalidate) parts.push(`revalidate=${JSON.stringify(route.revalidate)}`);
	return parts.join("  ");
}
function describeConstraint(constraint) {
	const { kind, pattern, ...rest } = constraint;
	const detail = Object.entries(rest).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" ");
	return `${kind} ${pattern}${detail ? `  ${detail}` : ""}`;
}
function formatFieldChange(change) {
	return `${change.field}: ${formatValue(change.from)} → ${formatValue(change.to)}`;
}
function formatValue(value) {
	if (value === null || value === void 0) return "none";
	if (Array.isArray(value)) return `[${value.map((entry) => String(entry)).join(", ")}]`;
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}
function budgetSuffix(budgets, path) {
	const budget = budgets.get(path);
	if (!budget) return "";
	const status = budget.ok ? "" : " ⚠ over budget";
	return `  (${formatBytes(budget.gzipBytes)} gz / ${formatBytes(budget.limitBytes)} limit${status})`;
}
function countLabel(count, label) {
	return count > 0 ? `${count} ${label}` : "";
}
//#endregion
export { readGraphSnapshotFromDisk as a, resolveLiveGraph as c, writeGraphSnapshot as d, formatPlanText as i, resolveLiveGraphMetadata as l, diffGraphSnapshots as n, readRouteBudgets as o, formatPlanMarkdown as r, resolveBaseSnapshot as s, GRAPH_SNAPSHOT_PATH as t, serializeGraphSnapshot as u };
