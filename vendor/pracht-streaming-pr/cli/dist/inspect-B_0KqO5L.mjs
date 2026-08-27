import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { t as readClientBuildAssets } from "./build-metadata-QAcUp6lA.mjs";
import { i as createSourceReader, n as capabilityModuleLoader, t as withAppServer } from "./app-server-Bd0VAe05.mjs";
import { p as handleCliError } from "./project-C-2I9C0N.mjs";
import { defineCommand } from "citty";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { serializeApiRoutes, serializeAppRoutes, serializeCapabilities } from "@pracht/core";
//#region src/commands/inspect.ts
var inspect_exports = /* @__PURE__ */ __exportAll({
	default: () => inspect_default,
	runInspect: () => runInspect
});
const INSPECT_TARGETS = new Set([
	"routes",
	"api",
	"capabilities",
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
			description: "Inspect target: routes, api, capabilities, build, or all",
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
		if (wants("capabilities")) report.capabilities = await serializeCapabilities(serverModule.resolvedApp.capabilities, {
			loadModule: capabilityModuleLoader(server, serverModule),
			readSource: createSourceReader(root, project.appFile)
		}, { strict: true });
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
			const transports = capability.transports.length > 0 ? capability.transports.join(",") : "private";
			console.log(`  ${capability.name}  effect=${capability.effect ?? "n/a"}  transports=${transports}  http=${capability.httpPath ?? "n/a"}  file=${capability.source}`);
			if (capability.error) console.log(`    ! schemas unavailable — module could not be loaded: ${capability.error}`);
		}
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
