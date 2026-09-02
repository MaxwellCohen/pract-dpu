import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { a as readProjectConfig, c as resolveProjectPath, f as ensureTrailingNewline, n as displayPath, p as handleCliError } from "./project-C-2I9C0N.mjs";
import { n as runInspect } from "./inspect-BepW0Qs9.mjs";
import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { extractCapabilityProjection } from "@pracht/capabilities/static";
import { schemaToTypeText } from "@pracht/capabilities";
//#region src/capability-consistency.ts
/**
* Cross-check the two ways pracht reads a capability's exposure.
*
* `pracht typegen` gets its metadata from the resolved app graph, which loads
* capability modules and reads the objects `defineCapability()` returned. The
* Vite plugin cannot do that — capability modules are server-only and must
* never enter the client graph — so it builds the browser endpoint table from
* static analysis of the same sources instead.
*
* Both feed the type layer: the graph decides what `Register["capabilities"]`
* marks as http-exposed, and the static pass decides which endpoints the
* generated client actually dispatches. If they disagreed, the generated types
* would promise a capability the browser bundle has no endpoint for — a
* compile-time green light for a call that 404s. Typegen is the moment those
* types are minted, so it is the right place to prove the two agree.
*/
/**
* Throw when the executed graph and the static analyzer disagree about a
* capability's HTTP path, effect class, or WebMCP exposure — including when
* static analysis cannot read an exposed capability at all, which is the most
* common way the two diverge (a computed `expose`, a hoisted constant).
*
* Capabilities whose source file is missing are skipped: the manifest check
* reports those, and duplicating it here would turn one problem into two.
*/
function assertCapabilityProjectionsAgree(project, capabilities) {
	if (capabilities.length === 0) return;
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	if (!existsSync(manifestPath)) return;
	const manifestDir = dirname(manifestPath);
	const drift = [];
	for (const capability of capabilities) {
		const filePath = capability.source.startsWith("/") ? resolveProjectPath(project.root, capability.source) : resolve(manifestDir, capability.source);
		if (!existsSync(filePath)) continue;
		if (capability.error != null) continue;
		let projection;
		try {
			projection = extractCapabilityProjection(capability.name, readFileSync(filePath, "utf-8"), (detail) => detail);
		} catch (error) {
			if (capability.httpPath !== null || capability.transports.length > 0) drift.push(`  ${capability.name} (${capability.source}): the app graph exposes it over ${describe(capability.httpPath)}, but static analysis cannot read its projection — ${error instanceof Error ? error.message : String(error)}`);
			continue;
		}
		for (const difference of compare(capability, projection)) drift.push(`  ${capability.name} (${capability.source}): ${difference}`);
	}
	if (drift.length > 0) throw new Error(`Capability exposure differs between the resolved app graph and build-time static analysis, so generated types would not match the endpoints the browser bundle registers:\n${drift.join("\n")}\nThis happens when \`expose\` or \`effect\` is computed rather than written as an inline literal. Declare them inline so both readers see the same contract.`);
}
function compare(graph, statically) {
	const differences = [];
	if (graph.httpPath !== statically.httpPath) differences.push(`HTTP endpoint is ${describe(graph.httpPath)} in the app graph but ${describe(statically.httpPath)} in static analysis`);
	if (statically.httpPath !== null && graph.effect !== null && graph.effect !== statically.effect) differences.push(`effect is ${describe(graph.effect)} in the app graph but ${describe(statically.effect)} in static analysis`);
	const graphWebmcp = graph.transports.includes("webmcp");
	if (graphWebmcp !== statically.webmcp) differences.push(`WebMCP exposure is ${graphWebmcp ? "on" : "off"} in the app graph but ${statically.webmcp ? "on" : "off"} in static analysis`);
	return differences;
}
function describe(value) {
	return value === null ? "none" : JSON.stringify(value);
}
//#endregion
//#region src/commands/typegen.ts
var typegen_exports = /* @__PURE__ */ __exportAll({
	DEFAULT_CAPABILITIES_OUT: () => DEFAULT_CAPABILITIES_OUT,
	DEFAULT_DECLARATION_OUT: () => DEFAULT_DECLARATION_OUT,
	DEFAULT_RUNTIME_OUT: () => DEFAULT_RUNTIME_OUT,
	default: () => typegen_default,
	runTypegen: () => runTypegen
});
const DEFAULT_DECLARATION_OUT = "src/pracht.d.ts";
const DEFAULT_RUNTIME_OUT = "src/pracht-routes.ts";
const DEFAULT_CAPABILITIES_OUT = "src/pracht-capabilities.d.ts";
const LEGACY_DECLARATION_OUT = "src/pracht-routes.d.ts";
var typegen_default = defineCommand({
	meta: {
		name: "typegen",
		description: "Generate typed route declarations and href helpers"
	},
	args: {
		out: {
			type: "string",
			description: `Declaration output path (default: ${DEFAULT_DECLARATION_OUT})`
		},
		"runtime-out": {
			type: "string",
			description: `Runtime href helper output path (default: ${DEFAULT_RUNTIME_OUT})`
		},
		"capabilities-out": {
			type: "string",
			description: `Capability declaration output path (default: ${DEFAULT_CAPABILITIES_OUT})`
		},
		check: {
			type: "boolean",
			description: "Check whether generated route files are up to date without writing"
		},
		json: {
			type: "boolean",
			description: "Output as JSON"
		}
	},
	async run({ args }) {
		const json = Boolean(args.json);
		try {
			const result = await runTypegen({
				capabilitiesOut: typeof args["capabilities-out"] === "string" ? args["capabilities-out"] : DEFAULT_CAPABILITIES_OUT,
				check: Boolean(args.check),
				declarationOut: typeof args.out === "string" ? args.out : DEFAULT_DECLARATION_OUT,
				root: process.cwd(),
				runtimeOut: typeof args["runtime-out"] === "string" ? args["runtime-out"] : DEFAULT_RUNTIME_OUT
			});
			if (json) {
				console.log(JSON.stringify({
					ok: true,
					...result
				}, null, 2));
				return;
			}
			if (result.check) {
				console.log("Generated route files are up to date.");
				return;
			}
			console.log("Generated typed routes:");
			for (const file of result.files) console.log(`  ${file}`);
		} catch (error) {
			handleCliError(error, { json });
		}
	}
});
/**
* Warn — do not block — when a capability module could not be executed.
*
* This is routinely a healthy app: a Cloudflare capability importing
* `cloudflare:workers` at the top level deploys fine and only fails to load in
* the CLI's Node graph server. Blocking here would strand it, because the same
* app is required to keep `.pracht/app-graph.json` fresh.
*
* Effect, exposure, policy and middleware are recovered from the source (the
* graph falls back to the same static extractor the browser projection uses),
* but only when they are inline literals; the output schema never is, so it
* types as `unknown`.
*/
function warnUnreadableCapabilities(capabilities) {
	const unreadable = capabilities.filter((capability) => capability.error);
	if (unreadable.length === 0) return;
	console.warn(`[pracht] ${unreadable.length} capability module(s) could not be loaded, so their types were recovered from source and their output types are \`unknown\`:
` + unreadable.map((capability) => `  ${capability.name} (${capability.source}): ${capability.error}`).join("\n") + "\nMove a runtime-only import (`cloudflare:workers`, a Node built-in in an edge module) inside `run()` or behind a dynamic import to get full types.");
}
async function runTypegen(options) {
	const report = await runInspect(options.root, {
		inspectApiMethods: false,
		target: [
			"routes",
			"api",
			"capabilities"
		]
	});
	const routes = report.routes ?? [];
	const apiRoutes = report.api ?? [];
	const capabilities = report.capabilities ?? [];
	validateRoutes(routes);
	validateApiRoutes(apiRoutes);
	const unreadableCapabilities = capabilities.filter((capability) => capability.error).map((capability) => ({
		name: capability.name,
		source: capability.source,
		error: String(capability.error)
	}));
	warnUnreadableCapabilities(capabilities);
	const project = readProjectConfig(options.root);
	assertCapabilityProjectionsAgree(project, capabilities);
	const declarationPath = resolveOutputPath(options.root, options.declarationOut);
	const runtimePath = resolveOutputPath(options.root, options.runtimeOut);
	const capabilitiesPath = resolveOutputPath(options.root, options.capabilitiesOut);
	if (outputsCollide(declarationPath, runtimePath)) throw new Error(`Declaration output ${options.declarationOut} shares its basename with ${options.runtimeOut}. TypeScript drops a .d.ts input that sits next to a same-named .ts file, so the generated route types would never apply. Pick a different --out.`);
	if (outputsCollide(capabilitiesPath, runtimePath)) throw new Error(`Capabilities output ${options.capabilitiesOut} shares its basename with ${options.runtimeOut}. TypeScript drops a .d.ts input that sits next to a same-named .ts file, so the generated capability types would never apply. Pick a different --capabilities-out.`);
	if (capabilitiesPath === declarationPath || outputsCollide(declarationPath, capabilitiesPath) || outputsCollide(capabilitiesPath, declarationPath)) throw new Error(`Capabilities output ${options.capabilitiesOut} collides with the declaration output ${options.declarationOut} — identical paths overwrite each other, and TypeScript drops a .d.ts input that sits next to a same-named .ts file. Pick a different --capabilities-out.`);
	const outputs = [{
		path: declarationPath,
		source: buildDeclarationSource(routes, apiRoutes, {
			appDir: dirname(resolveProjectPath(options.root, project.appFile)),
			declarationDir: dirname(declarationPath),
			root: options.root
		})
	}, {
		path: runtimePath,
		source: buildRuntimeSource(routes)
	}];
	if (capabilities.length > 0 || existsSync(capabilitiesPath)) outputs.push({
		path: capabilitiesPath,
		source: buildCapabilityDeclarationSource(capabilities)
	});
	if (options.check) {
		const stale = outputs.filter((output) => !fileMatches(output.path, output.source));
		if (stale.length > 0) {
			const files = stale.map((output) => displayPath(options.root, output.path)).join(", ");
			throw new Error(`Generated route files are out of date: ${files}. Run \`pracht typegen\`.`);
		}
	} else {
		for (const output of outputs) {
			if (fileMatches(output.path, output.source)) continue;
			mkdirSync(dirname(output.path), { recursive: true });
			writeFileSync(output.path, output.source, "utf-8");
		}
		removeLegacyDeclaration(options.root, declarationPath);
	}
	return {
		apiRoutes: apiRoutes.length,
		capabilities: capabilities.length,
		check: options.check,
		files: outputs.map((output) => displayPath(options.root, output.path)),
		mode: report.mode,
		routes: routes.length,
		...unreadableCapabilities.length > 0 ? { unreadableCapabilities } : {}
	};
}
function outputsCollide(declarationPath, runtimePath) {
	if (declarationPath === runtimePath) return true;
	const declarationStem = declarationPath.replace(/\.d\.(?:ts|mts|cts)$/, "");
	const runtimeStem = runtimePath.replace(/\.(?:ts|tsx|mts|cts)$/, "");
	return declarationStem !== declarationPath && declarationStem === runtimeStem;
}
function validateRoutes(routes) {
	const seen = /* @__PURE__ */ new Map();
	for (const route of routes) {
		if (!route.id) throw new Error(`Route ${route.path} resolved without an id.`);
		const previousPath = seen.get(route.id);
		if (previousPath) throw new Error(`Duplicate route id "${route.id}" for ${previousPath} and ${route.path}. Add explicit unique ids.`);
		seen.set(route.id, route.path);
		inferRouteParams(route.path);
	}
}
/**
* Earlier releases wrote the declaration to `src/pracht-routes.d.ts`, where
* the sibling `pracht-routes.ts` shadowed it (see DEFAULT_DECLARATION_OUT).
* Remove the stale, inert file when regenerating under the fixed name.
*/
function removeLegacyDeclaration(root, declarationPath) {
	const legacyPath = resolve(root, LEGACY_DECLARATION_OUT);
	if (legacyPath === declarationPath || !existsSync(legacyPath)) return;
	if (readFileSync(legacyPath, "utf-8").startsWith("// Generated by `pracht typegen`.")) rmSync(legacyPath);
}
function validateApiRoutes(apiRoutes) {
	for (const route of apiRoutes) inferRouteParams(route.path);
}
function buildDeclarationSource(routes, apiRoutes, context) {
	const lines = [
		"// Generated by `pracht typegen`. Do not edit manually.",
		"import \"@pracht/core\";",
		`import type { ${[
			...apiRoutes.some((route) => formatModuleSpecifier(route.file, context)) ? ["ApiRouteMethodMap"] : [],
			"RouteLoaderData",
			"RouteParamInput",
			"SearchParamsInput"
		].join(", ")} } from "@pracht/core";`,
		"",
		"declare module \"@pracht/core\" {",
		"  interface Register {",
		"    routes: {"
	];
	for (const route of routes) {
		lines.push(`      ${JSON.stringify(route.id)}: {`);
		lines.push(`        path: ${JSON.stringify(route.path)};`);
		lines.push(`        params: ${formatParamsType(inferRouteParams(route.path))};`);
		lines.push("        search: SearchParamsInput;");
		lines.push(`        data: ${formatRouteDataType(route, context)};`);
		lines.push("      };");
	}
	lines.push("    };");
	lines.push("    apiRoutes: {");
	for (const route of apiRoutes) {
		const moduleSpecifier = formatModuleSpecifier(route.file, context);
		lines.push(`      ${JSON.stringify(route.path)}: {`);
		lines.push(`        path: ${JSON.stringify(route.path)};`);
		lines.push(`        params: ${formatParamsType(inferRouteParams(route.path))};`);
		lines.push(moduleSpecifier ? `        methods: ApiRouteMethodMap<typeof import(${moduleSpecifier})>;` : "        methods: Record<never, never>;");
		lines.push("      };");
	}
	lines.push("    };");
	lines.push("  }");
	lines.push("}");
	lines.push("");
	lines.push("export {};");
	lines.push("");
	return lines.join("\n");
}
/**
* Register each capability's contract on `Register["capabilities"]`, the
* capability counterpart of the route declaration file. `invokeCapability()`,
* `callCapability()`, the generated `capabilities` client, `<Form capability>`,
* and the capability test host all read this registration once the file is in
* the program.
*
* Beyond input/output types the entry carries the parts of the contract the
* type layer enforces: `effect` (so a `destructive` call must present a
* confirmation token) and `exposed` (so only http-exposed capabilities are
* reachable from the browser).
*
* `title`/`description` are emitted as JSDoc on each registration entry and on
* each explicit nested-client leaf. String arguments to `callCapability()` do
* not carry that prose, but editor hovers on `capabilities.notes.search` do.
*/
function buildCapabilityDeclarationSource(capabilities) {
	const lines = [
		"// Generated by `pracht typegen`. Do not edit manually.",
		"import \"@pracht/core\";",
		"import type { CapabilityClientMethod } from \"@pracht/core\";",
		"",
		"declare module \"@pracht/core\" {",
		"  interface Register {"
	];
	if (capabilities.length === 0) lines.push("    capabilities: Record<never, never>;");
	else {
		lines.push("    capabilities: {");
		for (const capability of capabilities) {
			lines.push(...formatCapabilityDoc(capability));
			lines.push(`      ${JSON.stringify(capability.name)}: {`);
			lines.push(`        input: ${schemaToTypeText(capability.input, "input")};`);
			lines.push(`        output: ${schemaToTypeText(capability.output, "output")};`);
			lines.push(`        effect: ${formatCapabilityEffect(capability.effect)};`);
			lines.push(`        exposed: ${formatCapabilityExposure(capability.transports)};`);
			lines.push("      };");
		}
		lines.push("    };");
	}
	lines.push(...formatCapabilityClient(capabilities));
	lines.push("  }");
	lines.push("}");
	lines.push("");
	lines.push("export {};");
	lines.push("");
	return lines.join("\n");
}
/**
* Emit the nested browser client explicitly so JSDoc lives on the properties
* editors actually expose. A mapped type can reconstruct the shape, but
* TypeScript does not carry comments from the flat registration through it.
*/
function formatCapabilityClient(capabilities) {
	const exposed = capabilities.filter((capability) => capability.transports.includes("http"));
	if (exposed.length === 0) return ["    capabilityClient: Record<never, never>;"];
	const root = { children: /* @__PURE__ */ new Map() };
	for (const capability of exposed) {
		let node = root;
		for (const segment of capability.name.split(".")) {
			let child = node.children.get(segment);
			if (!child) {
				child = { children: /* @__PURE__ */ new Map() };
				node.children.set(segment, child);
			}
			node = child;
		}
		node.capability = capability;
	}
	return [
		"    capabilityClient: {",
		...formatCapabilityClientNode(root, "      "),
		"    };"
	];
}
function formatCapabilityClientNode(node, indent) {
	const lines = [];
	for (const [segment, child] of node.children) {
		if (child.children.size > 0) {
			lines.push(`${indent}${JSON.stringify(segment)}: {`);
			lines.push(...formatCapabilityClientNode(child, `${indent}  `));
			lines.push(`${indent}};`);
			continue;
		}
		if (child.capability) {
			lines.push(...formatCapabilityDoc(child.capability, indent));
			lines.push(`${indent}${JSON.stringify(segment)}: CapabilityClientMethod<${JSON.stringify(child.capability.name)}>;`);
		}
	}
	return lines;
}
/**
* The effect literal drives the type layer's confirmation gate. A registration
* whose module failed to load has no effect: widen to the full union rather
* than guessing, so a broken capability never silently loses its gate.
*/
function formatCapabilityEffect(effect) {
	return effect ? JSON.stringify(effect) : "\"read\" | \"write\" | \"destructive\"";
}
/** Exposure literals, so the browser client can drop private capabilities. */
function formatCapabilityExposure(transports) {
	const list = transports ?? [];
	const flag = (name) => list.includes(name) ? "true" : "false";
	return `{ http: ${flag("http")}; webmcp: ${flag("webmcp")}; mcp: ${flag("mcp")} }`;
}
/** `title`/`description` as JSDoc above a registration or client entry. */
function formatCapabilityDoc(capability, indent = "      ") {
	const parts = [capability.title, capability.description].filter((part) => typeof part === "string" && part.trim().length > 0);
	if (parts.length === 0) return [];
	const lines = [`${indent}/**`];
	for (const [index, part] of parts.entries()) {
		if (index > 0) lines.push(`${indent} *`);
		for (const line of part.trim().split(/\r?\n/)) lines.push(`${indent} * ${line.replaceAll("*/", "*\\/")}`.trimEnd());
	}
	lines.push(`${indent} */`);
	return lines;
}
function buildRuntimeSource(routes) {
	const lines = [
		"// Generated by `pracht typegen`. Do not edit manually.",
		"import { createHref } from \"@pracht/core\";",
		"import type { HrefRouteDefinition } from \"@pracht/core\";",
		"",
		"export const routes = ["
	];
	for (const route of routes) {
		lines.push("  {");
		lines.push(`    id: ${JSON.stringify(route.id)},`);
		lines.push(`    path: ${JSON.stringify(route.path)},`);
		lines.push("  },");
	}
	lines.push("] as const satisfies readonly HrefRouteDefinition[];");
	lines.push("");
	lines.push("export const href = createHref(routes);");
	lines.push("");
	return lines.join("\n");
}
function inferRouteParams(path) {
	const params = [];
	const seen = /* @__PURE__ */ new Set();
	for (const segment of path.split("/").filter(Boolean)) {
		let name = null;
		if (segment === "*") name = "*";
		else if (segment.startsWith(":")) name = segment.endsWith("*") ? segment.slice(1, -1) || "*" : segment.slice(1);
		if (!name) continue;
		if (seen.has(name)) throw new Error(`Route ${path} declares duplicate param "${name}".`);
		seen.add(name);
		params.push(name);
	}
	return params;
}
const IMPORTABLE_MODULE_PATTERN = /\.(ts|tsx|js|jsx)$/;
function formatRouteDataType(route, context) {
	const routeModule = formatModuleSpecifier(route.file, context);
	const loaderModule = route.loaderFile ? formatModuleSpecifier(route.loaderFile, context) : null;
	if (loaderModule) return routeModule ? `RouteLoaderData<typeof import(${loaderModule}), typeof import(${routeModule})>` : `RouteLoaderData<typeof import(${loaderModule})>`;
	return routeModule ? `RouteLoaderData<typeof import(${routeModule})>` : "unknown";
}
function formatModuleSpecifier(file, context) {
	if (!IMPORTABLE_MODULE_PATTERN.test(file)) return null;
	const absolutePath = file.startsWith("/") ? resolveProjectPath(context.root, file) : resolve(context.appDir, file);
	const relativePath = relative(context.declarationDir, absolutePath).replace(/\\/g, "/").replace(IMPORTABLE_MODULE_PATTERN, "");
	const specifier = relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
	return JSON.stringify(specifier);
}
function formatParamsType(params) {
	if (params.length === 0) return "Record<never, never>";
	return `{ ${params.map((param) => `${JSON.stringify(param)}: RouteParamInput;`).join(" ")} }`;
}
function resolveOutputPath(root, outputPath) {
	const absolutePath = isAbsolute(outputPath) ? outputPath : resolve(root, outputPath);
	const relativePath = relative(root, absolutePath);
	if (relativePath === "" || !relativePath.startsWith("..") && !isAbsolute(relativePath)) return absolutePath;
	throw new Error(`Refusing to write outside the project root: ${outputPath}.`);
}
function fileMatches(path, source) {
	return existsSync(path) && readFileSync(path, "utf-8") === ensureTrailingNewline(source);
}
//#endregion
export { typegen_exports as a, runTypegen as i, DEFAULT_DECLARATION_OUT as n, DEFAULT_RUNTIME_OUT as r, DEFAULT_CAPABILITIES_OUT as t };
