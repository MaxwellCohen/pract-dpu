import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { t as readClientBuildAssets } from "./build-metadata-QAcUp6lA.mjs";
import { d as serializeMcpAuth, g as collectCapabilityAppGraph, m as withAppServer, p as resolveBuildLlmsTxtEnabled } from "./graph-snapshot-C3nG4UBK.mjs";
import { p as handleCliError } from "./project-C-2I9C0N.mjs";
import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveMcpEndpoint, serializeApiRoutes, serializeAppRoutes } from "@pracht/core";
//#region src/commands/inspect.ts
var inspect_exports = /* @__PURE__ */ __exportAll({
	default: () => inspect_default,
	runInspect: () => runInspect,
	summarizeAgentSurface: () => summarizeAgentSurface
});
const INSPECT_TARGETS = new Set([
	"routes",
	"api",
	"capabilities",
	"agents",
	"build",
	"all"
]);
var inspect_default = defineCommand({
	meta: {
		name: "inspect",
		description: "Inspect resolved app graph"
	},
	args: {
		target: {
			type: "positional",
			description: "Inspect target: routes, api, capabilities, agents, build, or all",
			required: false
		},
		json: {
			type: "boolean",
			description: "Output as JSON"
		}
	},
	async run({ args }) {
		const target = args.target || "all";
		if (!INSPECT_TARGETS.has(target)) handleCliError(/* @__PURE__ */ new Error(`Unknown inspect target ${JSON.stringify(target)}. Valid targets: ${[...INSPECT_TARGETS].join(", ")}.`), { json: Boolean(args.json) });
		const report = await runInspect(process.cwd(), { target });
		if (args.json) {
			console.log(JSON.stringify(report, null, 2));
			return;
		}
		printInspectReport(report);
	}
});
function withEffectiveHydration(route) {
	return {
		...route,
		hydrationEffective: route.hydration ?? "full"
	};
}
async function runInspect(root, { inspectApiMethods = true, target = "all" } = {}) {
	const targets = new Set(Array.isArray(target) ? target : [target]);
	const wants = (name) => targets.has(name) || targets.has("all");
	const llmsTxtEnabled = wants("agents") ? await resolveBuildLlmsTxtEnabled(root) : null;
	return withAppServer(root, async ({ project, server, serverModule }) => {
		const report = { mode: project.mode };
		if (wants("routes")) {
			report.routes = serializeAppRoutes(serverModule.resolvedApp.routes).map(withEffectiveHydration);
			const notFound = serverModule.resolvedApp.notFound;
			report.notFound = notFound ? withEffectiveHydration(serializeAppRoutes([notFound])[0]) : null;
		}
		if (wants("api")) report.api = inspectApiMethods ? await serializeApiRoutes(serverModule.apiRoutes, {
			loadModule: (file) => server.ssrLoadModule(file),
			readSource: (file) => readFileSync(resolve(root, `.${file}`), "utf-8")
		}, { strict: true }) : serverModule.apiRoutes.map(({ file, path }) => ({
			file,
			hasDefaultHandler: false,
			methods: [],
			path
		}));
		const capabilityGraph = wants("capabilities") || wants("agents") ? await collectCapabilityAppGraph(server, root, serverModule, {
			appFile: project.appFile,
			strict: true
		}) : null;
		if (capabilityGraph) {
			report.mcpDestructive = capabilityGraph.mcpDestructive;
			report.mcpEndpoint = capabilityGraph.mcpEndpoint;
			report.mcpRuntimeStatus = capabilityGraph.mcpRuntimeStatus;
			report.mcpUnavailableReasons = capabilityGraph.mcpUnavailableReasons;
		}
		if (wants("capabilities") && capabilityGraph) report.capabilities = capabilityGraph.capabilities;
		if (wants("agents") && capabilityGraph) report.agents = summarizeAgentSurface(serverModule.resolvedApp.agents, capabilityGraph.capabilities, llmsTxtEnabled);
		if (wants("build")) {
			const buildAssets = readClientBuildAssets(root, typeof serverModule.buildBase === "string" ? serverModule.buildBase : "/");
			report.build = {
				adapterTarget: serverModule.buildTarget,
				clientEntryUrl: buildAssets.clientEntryUrl,
				cssManifest: buildAssets.cssManifest,
				jsManifest: buildAssets.jsManifest
			};
		}
		return report;
	});
}
function summarizeAgentSurface(agents, capabilities, llmsTxtEnabled) {
	const exposure = {
		http: 0,
		webmcp: 0,
		mcp: 0,
		private: 0
	};
	for (const capability of capabilities) {
		if (capability.transports.length === 0) {
			exposure.private += 1;
			continue;
		}
		for (const transport of capability.transports) if (transport === "http" || transport === "webmcp" || transport === "mcp") exposure[transport] += 1;
	}
	return {
		webBotAuth: {
			enabled: agents?.webBotAuth !== void 0,
			policy: agents?.webBotAuth?.policy ?? "observe",
			staticKeys: agents?.webBotAuth?.keys?.length ?? 0,
			directories: agents?.webBotAuth?.directories ?? []
		},
		confirmation: {
			mode: agents?.confirmation?.mode ?? "token",
			ttlSeconds: agents?.confirmation?.ttlSeconds ?? null,
			singleUse: agents?.confirmation?.singleUse ?? false
		},
		mcp: {
			enabled: agents?.mcp !== void 0,
			endpoint: resolveMcpEndpoint(agents),
			authenticated: agents?.mcp?.auth !== void 0,
			auth: serializeMcpAuth(agents?.mcp?.auth)
		},
		llmsTxt: { enabled: llmsTxtEnabled },
		capabilities: capabilities.map((capability) => ({
			name: capability.name,
			effect: capability.effect,
			agentPolicy: capability.agentPolicy,
			transports: capability.transports,
			httpPath: capability.httpPath
		})),
		exposure
	};
}
function formatCapabilityTransports(capability, report) {
	return capability.transports.length > 0 ? capability.transports.map((transport) => transport !== "mcp" ? transport : report.mcpEndpoint === null || capability.effect === "destructive" && report.mcpDestructive !== true || report.mcpRuntimeStatus === "blocked" ? "mcp(unserved)" : report.mcpRuntimeStatus === "unverified" ? "mcp(unverified)" : transport).join(",") : "private";
}
function printMcpInspectionStatus(report) {
	if (report.mcpEndpoint !== null) console.log(`  MCP endpoint: ${report.mcpEndpoint}`);
	if ((report.mcpUnavailableReasons?.length ?? 0) > 0) console.log(report.mcpRuntimeStatus === "unverified" ? `  ! MCP endpoint unverified: ${report.mcpUnavailableReasons.join(" ")} Registrations in the adapter server entry are not evaluated by graph-only inspection.` : `  ! MCP endpoint unavailable: ${report.mcpUnavailableReasons.join(" ")}`);
}
function printInspectReport(report) {
	console.log(`Pracht inspect (${report.mode} mode)`);
	if (report.routes) {
		console.log("\nRoutes");
		for (const route of report.routes) console.log(`  ${route.path}  id=${route.id}  render=${route.render ?? "n/a"}  hydration=${route.hydration ?? "full"}  streaming=${route.streaming === true ? "true" : "false"}  shell=${route.shell ?? "none"}  middleware=[${route.middleware.join(", ")}]  file=${route.file}`);
		console.log("\nNot found page");
		console.log(report.notFound ? `  ${report.notFound.path}  shell=${report.notFound.shell ?? "n/a"}  hydration=${report.notFound.hydration ?? "full"}  streaming=${report.notFound.streaming === true ? "true" : "false"}  middleware=[${report.notFound.middleware.join(", ")}]  file=${report.notFound.file}` : "  None declared — unmatched URLs return a plain-text 404.");
	}
	if (report.api) {
		console.log("\nAPI");
		if (report.api.length === 0) console.log("  No API routes found.");
		else for (const route of report.api) {
			const explicitMethods = route.methods.join(",");
			const methods = route.hasDefaultHandler ? explicitMethods ? `${explicitMethods}+default` : "default" : explicitMethods || "none";
			console.log(`  ${route.path}  methods=${methods}  file=${route.file}`);
		}
	}
	if (report.capabilities) {
		console.log("\nCapabilities");
		if (report.capabilities.length === 0) console.log("  No capabilities registered.");
		else for (const capability of report.capabilities) {
			const transports = formatCapabilityTransports(capability, report);
			console.log(`  ${capability.name}  effect=${capability.effect ?? "n/a"}  transports=${transports}  http=${capability.httpPath ?? "n/a"}  file=${capability.source}`);
			if (capability.error) console.log(`    ! schemas unavailable — module could not be loaded: ${capability.error}`);
		}
		if (!report.agents) printMcpInspectionStatus(report);
	}
	if (report.agents) {
		const agents = report.agents;
		console.log("\nAgents");
		console.log(`  webBotAuth=${agents.webBotAuth.enabled ? "on" : "off"}  policy=${agents.webBotAuth.policy}  keys=${agents.webBotAuth.staticKeys}  directories=[${agents.webBotAuth.directories.join(", ")}]`);
		console.log(`  confirmation=${agents.confirmation.mode}  ttlSeconds=${agents.confirmation.ttlSeconds ?? "default"}  singleUse=${agents.confirmation.singleUse}`);
		console.log(`  mcp=${agents.mcp.enabled ? "on" : "off"}  endpoint=${agents.mcp.endpoint ?? "n/a"}  oauth=${agents.mcp.authenticated ? "on" : "off"}`);
		if (agents.mcp.auth) console.log(`    resource=${agents.mcp.auth.resource}  authorizationServers=[${agents.mcp.auth.authorizationServers.join(", ")}]  requiredScopes=[${agents.mcp.auth.requiredScopes.join(", ")}]  scopesSupported=[${agents.mcp.auth.scopesSupported.join(", ")}]`);
		console.log(`  llmsTxt=${agents.llmsTxt.enabled === null ? "unknown (upgrade @pracht/vite-plugin)" : agents.llmsTxt.enabled ? "on" : "off"}`);
		console.log(`  exposure  http=${agents.exposure.http}  webmcp=${agents.exposure.webmcp}  mcp=${agents.exposure.mcp}  private=${agents.exposure.private}`);
		if (agents.capabilities.length === 0) console.log("  No capability operations registered.");
		else for (const capability of agents.capabilities) {
			const transports = formatCapabilityTransports(capability, report);
			console.log(`  ${capability.name}  effect=${capability.effect ?? "n/a"}  transports=${transports}  policy=${capability.agentPolicy ?? `${agents.webBotAuth.policy} (inherited)`}  http=${capability.httpPath ?? "n/a"}`);
		}
		printMcpInspectionStatus(report);
		if (agents.exposure.mcp > 0 && !agents.mcp.enabled) console.log("    ! capabilities set expose.mcp but agents.mcp is unconfigured — the exposure is recorded and nothing serves it.");
	}
	if (report.build) {
		console.log("\nBuild");
		console.log(`  adapterTarget=${report.build.adapterTarget}`);
		console.log(`  clientEntryUrl=${report.build.clientEntryUrl ?? "null"}`);
		console.log(`  cssManifestKeys=${Object.keys(report.build.cssManifest).length}`);
		console.log(`  jsManifestKeys=${Object.keys(report.build.jsManifest).length}`);
	}
}
//#endregion
export { runInspect as n, inspect_exports as t };
