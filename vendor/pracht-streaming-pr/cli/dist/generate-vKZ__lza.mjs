import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { _ as requireEnum, a as readProjectConfig, c as resolveProjectPath, d as writeGeneratedFile, f as ensureTrailingNewline, g as quote, h as parseCommaList, l as resolveRouteModulePath, m as parseApiMethods, n as displayPath, o as resolveApiModulePath, p as handleCliError, s as resolvePagesRouteModulePath, t as assertFileExists, u as resolveScopedFile, v as requirePositiveInteger } from "./project-C-2I9C0N.mjs";
import { a as toManifestModulePath, i as insertArrayItem, n as extractRegistryEntries, o as upsertObjectEntry, t as ensureCoreNamedImport } from "./manifest-D4EPJS5G.mjs";
import { defineCommand } from "citty";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
//#region src/commands/generate-paths.ts
function normalizeRoutePathString(value) {
	if (!value || value === "/") return "/";
	const normalized = `/${value}`.replace(/\/+/g, "/");
	return normalized !== "/" && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
function normalizeApiPath(value) {
	return normalizeRoutePathString(value).replace(/^\/api(?=\/|$)/, "") || "/";
}
function hasDynamicSegments(routePath) {
	return routePath.split("/").some((segment) => segment.startsWith(":") || segment === "*");
}
function dynamicParamNames(routePath) {
	return routePath.split("/").filter(Boolean).map((segment) => {
		if (segment.startsWith(":")) return segment.slice(1);
		if (segment === "*") return "slug";
		return null;
	}).filter((s) => s !== null);
}
function routeIdFromPath(routePath) {
	if (routePath === "/") return "index";
	return routePath.split("/").filter(Boolean).map((segment) => segment.replace(/^:/, "").replace(/\*/g, "splat")).join("-");
}
function titleFromPath(routePath) {
	if (routePath === "/") return "Home";
	return titleCase((routePath.split("/").filter(Boolean).at(-1) ?? "Page").replace(/^:/, "").replace(/\*/g, "slug"));
}
function titleCase(value) {
	return value.split(/[-_/]/).filter(Boolean).map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)).join(" ");
}
//#endregion
//#region src/commands/generate-source.ts
function buildManifestRouteModuleSource(opts) {
	const sections = buildRouteModuleSections(opts);
	const componentIdx = sections.findIndex((s) => s.startsWith("export function Component"));
	const insertAt = componentIdx === -1 ? sections.length : componentIdx;
	sections.splice(insertAt, 0, "export function head() {", `  return { title: ${quote(opts.title)} };`, "}", "");
	return `${sections.join("\n")}\n`;
}
function buildPagesRouteModuleSource(opts) {
	const sections = buildRouteModuleSections(opts);
	const firstExportIdx = sections.findIndex((s) => s.startsWith("export"));
	const insertAt = firstExportIdx === -1 ? sections.length : firstExportIdx;
	const policyExports = [`export const RENDER_MODE = ${quote(opts.render)};`];
	if (opts.revalidateSeconds !== void 0) policyExports.push(`export const REVALIDATE = ${opts.revalidateSeconds};`);
	sections.splice(insertAt, 0, ...policyExports, "");
	return `${sections.join("\n")}\n`;
}
function buildShellModuleSource(name) {
	const title = titleCase(name);
	return [
		"import type { ShellProps } from \"@pracht/core\";",
		"",
		"export function Shell({ children }: ShellProps) {",
		"  return (",
		`    <div class=${quote(`${name}-shell`)}>`,
		"      <main>{children}</main>",
		"    </div>",
		"  );",
		"}",
		"",
		"export function head() {",
		`  return { title: ${quote(title)} };`,
		"}",
		""
	].join("\n");
}
function buildMiddlewareModuleSource() {
	return [
		"import type { MiddlewareFn } from \"@pracht/core\";",
		"",
		"export const middleware: MiddlewareFn = async (_args, next) => {",
		"  return next();",
		"};",
		""
	].join("\n");
}
/**
* A capability module skeleton.
*
* `expose`, `effect`, and `input` are emitted as inline object/string literals
* on purpose: the browser and WebMCP projections are built by static analysis,
* which cannot follow an imported constant or a spread, and the build fails
* when it cannot read them.
*/
function buildCapabilityModuleSource(options) {
	const exposeEntries = options.expose.map((transport) => `${transport}: true`).join(", ");
	return [
		"import { defineCapability, type CapabilityRunArgs } from \"@pracht/capabilities\";",
		"",
		"interface Input {",
		"  query: string;",
		"}",
		"",
		"export default defineCapability({",
		`  title: ${JSON.stringify(options.title)},`,
		`  description: ${JSON.stringify(options.description)},`,
		"  input: {",
		"    type: \"object\",",
		"    properties: {",
		"      query: { type: \"string\", minLength: 1 },",
		"    },",
		"    required: [\"query\"],",
		"    additionalProperties: false,",
		"  },",
		"  output: {",
		"    type: \"object\",",
		"    properties: {",
		"      result: { type: \"string\" },",
		"    },",
		"    required: [\"result\"],",
		"  },",
		`  effect: ${JSON.stringify(options.effect)},`,
		...exposeEntries ? [`  expose: { ${exposeEntries} },`] : ["  // Private by default — add `expose: { http: true }` to make it callable."],
		"  async run({ input }: CapabilityRunArgs<Input>) {",
		"    return { result: input.query };",
		"  },",
		"});",
		""
	].join("\n");
}
/**
* A Playwright smoke test emitted alongside a generated route: the route
* serves successfully and renders its heading. Output-level proof the route
* exists, cheap enough to run on every change.
*/
function buildRouteSmokeTestSource({ routePath, title }) {
	const visitPath = exampleVisitPath(routePath);
	return [
		"import { expect, test } from \"@playwright/test\";",
		"",
		`test(${quote(`renders ${routePath}`)}, async ({ page }) => {`,
		`  const response = await page.goto(${quote(visitPath)});`,
		"  expect(response?.status(), \"route should serve successfully\").toBeLessThan(400);",
		`  await expect(page.locator("h1").first()).toHaveText(${quote(title)});`,
		"});",
		""
	].join("\n");
}
/** Substitute example values for dynamic segments, matching the getStaticPaths stub. */
function exampleVisitPath(routePath) {
	if (routePath === "/") return "/";
	return `/${routePath.split("/").filter(Boolean).map((segment) => {
		if (segment === "*") return "example-slug";
		if (segment.startsWith(":")) return `example-${(segment.endsWith("*") ? segment.slice(1, -1) : segment.slice(1)) || "slug"}`;
		return segment;
	}).join("/")}`;
}
function buildApiRouteSource({ endpointPath, methods }) {
	return [
		"import type { ApiRouteArgs } from \"@pracht/core\";",
		"",
		...methods.flatMap((method, index) => {
			const lines = buildApiMethodSource(method, methods, endpointPath);
			if (index === methods.length - 1) return lines;
			return [...lines, ""];
		}),
		""
	].join("\n");
}
function buildRouteModuleSections(opts) {
	const { includeErrorBoundary, includeLoader, includeStaticPaths, routePath, title } = opts;
	const params = dynamicParamNames(routePath);
	const imports = [];
	const sections = [];
	if (includeLoader) imports.push("LoaderArgs", "RouteComponentProps");
	if (includeErrorBoundary) imports.push("ErrorBoundaryProps");
	if (imports.length > 0) {
		sections.push(`import type { ${imports.join(", ")} } from "@pracht/core";`);
		sections.push("");
	}
	if (includeLoader) sections.push("export async function loader(_args: LoaderArgs) {", `  return { message: ${quote(`Welcome to ${title}.`)} };`, "}", "");
	if (includeStaticPaths) sections.push("export function getStaticPaths() {", `  return [${buildStaticPathsStub(params)}];`, "}", "");
	if (includeLoader) sections.push("export function Component({ data }: RouteComponentProps<typeof loader>) {", "  return (", "    <section>", `      <h1>${escapeJsxText(title)}</h1>`, "      <p>{data.message}</p>", "    </section>", "  );", "}");
	else sections.push("export function Component() {", "  return (", "    <section>", `      <h1>${escapeJsxText(title)}</h1>`, "    </section>", "  );", "}");
	if (includeErrorBoundary) sections.push("", "export function ErrorBoundary({ error }: ErrorBoundaryProps) {", "  return <p>{error.message}</p>;", "}");
	return sections;
}
function buildApiMethodSource(method, methods, endpointPath) {
	if (method === "DELETE" || method === "HEAD") return [
		`export function ${method}(_args: ApiRouteArgs) {`,
		"  return new Response(null, { status: 204 });",
		"}"
	];
	if (method === "OPTIONS") return [
		`export function ${method}(_args: ApiRouteArgs) {`,
		"  return new Response(null, {",
		`    headers: { allow: ${quote(methods.join(", "))} },`,
		"    status: 204,",
		"  });",
		"}"
	];
	if (method === "GET") return [
		`export function ${method}(_args: ApiRouteArgs) {`,
		`  return Response.json({ endpoint: ${quote(`/api${endpointPath}`)}, ok: true });`,
		"}"
	];
	const status = method === "POST" ? 201 : 200;
	return [
		`export async function ${method}({ request }: ApiRouteArgs) {`,
		"  const body = await request.json();",
		`  return Response.json({ body, ok: true }, { status: ${status} });`,
		"}"
	];
}
function buildStaticPathsStub(params) {
	if (params.length === 0) return "{}";
	return `{ ${params.map((name) => `${name}: ${quote(`example-${name}`)}`).join(", ")} }`;
}
function escapeJsxText(value) {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
//#endregion
//#region src/commands/generate.ts
var generate_exports = /* @__PURE__ */ __exportAll({
	default: () => generate_default,
	generateApi: () => generateApi,
	generateCapability: () => generateCapability,
	generateMiddleware: () => generateMiddleware,
	generateRoute: () => generateRoute,
	generateShell: () => generateShell
});
const routeCommand = defineCommand({
	meta: {
		name: "route",
		description: "Scaffold a route module"
	},
	args: {
		path: {
			type: "string",
			required: true,
			description: "Route path (e.g. /dashboard)"
		},
		render: {
			type: "string",
			description: "Render mode: ssr, spa, ssg, or isg"
		},
		shell: {
			type: "string",
			description: "Shell name"
		},
		middleware: {
			type: "string",
			description: "Middleware names (comma-separated)"
		},
		loader: {
			type: "boolean",
			description: "Include loader"
		},
		"error-boundary": {
			type: "boolean",
			description: "Include error boundary"
		},
		"static-paths": {
			type: "boolean",
			description: "Include static paths"
		},
		title: {
			type: "string",
			description: "Page title"
		},
		revalidate: {
			type: "string",
			description: "ISG revalidation seconds"
		},
		test: {
			type: "boolean",
			description: "Emit a Playwright smoke test in e2e/ (default: on when the app has a Playwright setup; --no-test to skip)"
		},
		json: {
			type: "boolean",
			description: "Output as JSON"
		}
	},
	async run({ args }) {
		try {
			outputResult(generateRoute(args, readProjectConfig(process.cwd())), Boolean(args.json));
		} catch (error) {
			handleCliError(error, { json: Boolean(args.json) });
		}
	}
});
const shellCommand = defineCommand({
	meta: {
		name: "shell",
		description: "Scaffold a shell component"
	},
	args: {
		name: {
			type: "string",
			required: true,
			description: "Shell name"
		},
		json: {
			type: "boolean",
			description: "Output as JSON"
		}
	},
	async run({ args }) {
		try {
			const project = readProjectConfig(process.cwd());
			outputResult(generateShell(args.name, project), Boolean(args.json));
		} catch (error) {
			handleCliError(error, { json: Boolean(args.json) });
		}
	}
});
const middlewareCommand = defineCommand({
	meta: {
		name: "middleware",
		description: "Scaffold a middleware function"
	},
	args: {
		name: {
			type: "string",
			required: true,
			description: "Middleware name"
		},
		json: {
			type: "boolean",
			description: "Output as JSON"
		}
	},
	async run({ args }) {
		try {
			const project = readProjectConfig(process.cwd());
			outputResult(generateMiddleware(args.name, project), Boolean(args.json));
		} catch (error) {
			handleCliError(error, { json: Boolean(args.json) });
		}
	}
});
const CAPABILITY_NAME_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;
const capabilityCommand = defineCommand({
	meta: {
		name: "capability",
		description: "Scaffold a capability module"
	},
	args: {
		name: {
			type: "string",
			required: true,
			description: "Dot-separated capability name, e.g. notes.search"
		},
		effect: {
			type: "string",
			description: "Effect class: read, write, or destructive (defaults to read)"
		},
		expose: {
			type: "string",
			description: "Transports to expose, comma-separated: http, webmcp, mcp. Omit to keep it private."
		},
		title: {
			type: "string",
			description: "Human-readable title"
		},
		description: {
			type: "string",
			description: "Contract description (required when exposed)"
		},
		json: {
			type: "boolean",
			description: "Output as JSON"
		}
	},
	async run({ args }) {
		try {
			outputResult(generateCapability(args, readProjectConfig(process.cwd())), Boolean(args.json));
		} catch (error) {
			handleCliError(error, { json: Boolean(args.json) });
		}
	}
});
var generate_default = defineCommand({
	meta: {
		name: "generate",
		description: "Scaffold framework files"
	},
	subCommands: {
		route: routeCommand,
		shell: shellCommand,
		middleware: middlewareCommand,
		api: defineCommand({
			meta: {
				name: "api",
				description: "Scaffold an API route"
			},
			args: {
				path: {
					type: "string",
					required: true,
					description: "API endpoint path"
				},
				methods: {
					type: "string",
					description: "HTTP methods (comma-separated, e.g. GET,POST)"
				},
				json: {
					type: "boolean",
					description: "Output as JSON"
				}
			},
			async run({ args }) {
				try {
					outputResult(generateApi(args, readProjectConfig(process.cwd())), Boolean(args.json));
				} catch (error) {
					handleCliError(error, { json: Boolean(args.json) });
				}
			}
		}),
		capability: capabilityCommand
	}
});
function outputResult(result, json) {
	if (json) {
		console.log(JSON.stringify({
			ok: true,
			...result
		}, null, 2));
		return;
	}
	console.log(`Created ${result.kind}:`);
	for (const file of result.created) console.log(`  ${file}`);
	for (const file of result.updated) console.log(`  updated ${file}`);
	for (const note of result.notes ?? []) {
		console.log("");
		console.log(note);
	}
}
function generateRoute(args, project) {
	const routePath = normalizeRoutePathString(args.path);
	const render = requireEnum(args.render, "render", [
		"spa",
		"ssr",
		"ssg",
		"isg"
	], "ssr");
	if (render !== "isg" && args.revalidate !== void 0) throw new Error("`--revalidate` is only valid together with `--render isg`.");
	const revalidateSeconds = render === "isg" ? requirePositiveInteger(args.revalidate, "revalidate", 3600) : void 0;
	const includeLoader = Boolean(args.loader);
	const includeErrorBoundary = Boolean(args["error-boundary"]);
	const middleware = parseCommaList(args.middleware);
	const includeStaticPaths = Boolean(args["static-paths"]) || hasDynamicSegments(routePath) && (render === "ssg" || render === "isg");
	const title = args.title ?? titleFromPath(routePath);
	if (project.mode === "pages") {
		if (args.shell) throw new Error("`pracht generate route --shell` is only available for manifest apps.");
		if (middleware.length > 0) throw new Error("`pracht generate route --middleware` is only available for manifest apps.");
		const result = generatePagesRoute({
			includeErrorBoundary,
			includeLoader,
			includeStaticPaths,
			project,
			render,
			revalidateSeconds,
			routePath,
			title
		});
		maybeGenerateSmokeTest(project, routePath, title, args.test, result);
		return result;
	}
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);
	const manifestSource = readFileSync(manifestPath, "utf-8");
	const registeredShells = new Set(extractRegistryEntries(manifestSource, "shells").map((entry) => entry.name));
	const registeredMiddleware = new Set(extractRegistryEntries(manifestSource, "middleware").map((entry) => entry.name));
	const shellName = args.shell;
	if (shellName && !registeredShells.has(shellName)) throw new Error(`Shell "${shellName}" is not registered in ${project.appFile}.`);
	for (const name of middleware) if (!registeredMiddleware.has(name)) throw new Error(`Middleware "${name}" is not registered in ${project.appFile}.`);
	const routeFile = resolveRouteModulePath(project, routePath, ".tsx");
	writeGeneratedFile(routeFile.absolutePath, buildManifestRouteModuleSource({
		includeErrorBoundary,
		includeLoader,
		includeStaticPaths,
		routePath,
		title
	}));
	let nextManifestSource = ensureCoreNamedImport(manifestSource, "route");
	if (render === "isg") nextManifestSource = ensureCoreNamedImport(nextManifestSource, "timeRevalidate");
	const routeModulePath = toManifestModulePath(manifestPath, routeFile.absolutePath);
	const meta = [`id: ${quote(routeIdFromPath(routePath))}`, `render: ${quote(render)}`];
	if (shellName) meta.push(`shell: ${quote(shellName)}`);
	if (middleware.length > 0) meta.push(`middleware: [${middleware.map((item) => quote(item)).join(", ")}]`);
	if (render === "isg") meta.push(`revalidate: timeRevalidate(${revalidateSeconds})`);
	nextManifestSource = insertArrayItem(nextManifestSource, "routes", [
		`route(${quote(routePath)}, ${quote(routeModulePath)}, {`,
		...meta.map((line) => `  ${line},`),
		"})"
	].join("\n"));
	writeFileSync(manifestPath, ensureTrailingNewline(nextManifestSource), "utf-8");
	const result = {
		created: [displayPath(project.root, routeFile.absolutePath)],
		kind: "route",
		updated: [displayPath(project.root, manifestPath)]
	};
	maybeGenerateSmokeTest(project, routePath, title, args.test, result);
	return result;
}
/**
* Emit a Playwright smoke test next to a generated route. Defaults to on when
* the app has a Playwright setup (playwright.config.* or an e2e/ directory);
* `--test` forces emission, `--no-test` skips it.
*/
function maybeGenerateSmokeTest(project, routePath, title, testFlag, result) {
	if (!(testFlag ?? hasPlaywrightSetup(project.root))) return;
	const testFile = resolve(project.root, "e2e", `${routeIdFromPath(routePath)}.spec.ts`);
	writeGeneratedFile(testFile, buildRouteSmokeTestSource({
		routePath,
		title
	}));
	result.created.push(displayPath(project.root, testFile));
	if (!hasPlaywrightDependency(project.root)) {
		result.notes ??= [];
		result.notes.push("The generated smoke test imports `@playwright/test`, which is not installed yet. Install it with your package manager (for example: npm install --save-dev @playwright/test).");
	}
}
function hasPlaywrightSetup(root) {
	return [
		"playwright.config.ts",
		"playwright.config.mts",
		"playwright.config.js",
		"playwright.config.mjs"
	].map((name) => resolve(root, name)).some((file) => existsSync(file)) || existsSync(resolve(root, "e2e"));
}
function hasPlaywrightDependency(root) {
	try {
		const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
		return Boolean(packageJson.dependencies?.["@playwright/test"] ?? packageJson.devDependencies?.["@playwright/test"]);
	} catch {
		return true;
	}
}
function generatePagesRoute({ includeErrorBoundary, includeLoader, includeStaticPaths, project, render, revalidateSeconds, routePath, title }) {
	const routeFile = resolvePagesRouteModulePath(project, routePath, ".tsx");
	writeGeneratedFile(routeFile.absolutePath, buildPagesRouteModuleSource({
		includeErrorBoundary,
		includeLoader,
		includeStaticPaths,
		render,
		revalidateSeconds,
		routePath,
		title
	}));
	return {
		created: [displayPath(project.root, routeFile.absolutePath)],
		kind: "route",
		updated: []
	};
}
function generateShell(name, project) {
	if (project.mode === "pages") throw new Error("Pages router apps use a single `_app` shell. `pracht generate shell` is only available for manifest apps.");
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);
	const shellFile = resolveScopedFile(project.root, project.shellsDir, `${name}.tsx`);
	writeGeneratedFile(shellFile, buildShellModuleSource(name));
	writeFileSync(manifestPath, ensureTrailingNewline(upsertObjectEntry(readFileSync(manifestPath, "utf-8"), "shells", `${name}: ${quote(toManifestModulePath(manifestPath, shellFile))}`)), "utf-8");
	return {
		created: [displayPath(project.root, shellFile)],
		kind: "shell",
		updated: [displayPath(project.root, manifestPath)]
	};
}
function generateMiddleware(name, project) {
	if (project.mode === "pages") throw new Error("Pages router apps do not use manifest middleware registration. `pracht generate middleware` is only available for manifest apps.");
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);
	const middlewareFile = resolveScopedFile(project.root, project.middlewareDir, `${name}.ts`);
	writeGeneratedFile(middlewareFile, buildMiddlewareModuleSource());
	writeFileSync(manifestPath, ensureTrailingNewline(upsertObjectEntry(readFileSync(manifestPath, "utf-8"), "middleware", `${name}: ${quote(toManifestModulePath(manifestPath, middlewareFile))}`)), "utf-8");
	return {
		created: [displayPath(project.root, middlewareFile)],
		kind: "middleware",
		updated: [displayPath(project.root, manifestPath)]
	};
}
const CAPABILITY_TRANSPORTS = [
	"http",
	"webmcp",
	"mcp"
];
function generateCapability(args, project) {
	if (project.mode === "pages") throw new Error("Pages router apps have no manifest to register capabilities in. `pracht generate capability` is only available for manifest apps.");
	const name = args.name;
	if (!CAPABILITY_NAME_RE.test(name)) throw new Error(`Invalid capability name ${quote(name)}. Names are dot-separated segments of letters, numbers, hyphens, and underscores — e.g. "notes.search".`);
	const effect = requireEnum(args.effect, "effect", [
		"read",
		"write",
		"destructive"
	], "read");
	const expose = parseCommaList(args.expose);
	for (const transport of expose) if (!CAPABILITY_TRANSPORTS.includes(transport)) throw new Error(`Unknown transport ${quote(transport)} in --expose. Expected one of ${CAPABILITY_TRANSPORTS.join(", ")}.`);
	if (effect === "destructive" && expose.some((transport) => transport !== "http")) throw new Error("A destructive capability may only be exposed over http — agent hosts cannot be trusted to carry the prepare/commit confirmation flow. Drop webmcp/mcp from --expose.");
	if (expose.includes("webmcp") && !expose.includes("http")) throw new Error("`--expose webmcp` requires http: the page tool calls the HTTP projection.");
	if (expose.length > 0 && !args.description) throw new Error("`--description` is required when --expose is set: it is the contract text agents read, and `pracht verify` fails without one.");
	const manifestPath = resolveProjectPath(project.root, project.appFile);
	assertFileExists(manifestPath, `App manifest not found at ${project.appFile}.`);
	const capabilityFile = resolveScopedFile(project.root, project.capabilitiesDir, `${name.replaceAll(".", "-")}.ts`);
	writeGeneratedFile(capabilityFile, buildCapabilityModuleSource({
		description: args.description ?? `TODO: describe what ${name} does.`,
		effect,
		expose,
		title: args.title ?? titleFromPath(`/${name.replaceAll(".", " ")}`)
	}));
	writeFileSync(manifestPath, ensureTrailingNewline(upsertObjectEntry(readFileSync(manifestPath, "utf-8"), "capabilities", `${quote(name)}: ${quote(toManifestModulePath(manifestPath, capabilityFile))}`)), "utf-8");
	return {
		created: [displayPath(project.root, capabilityFile)],
		kind: "capability",
		...hasCapabilitiesDependency(project.root) ? {} : { notes: ["This module imports `@pracht/capabilities`, which is not installed yet. Run: npm install @pracht/capabilities"] },
		updated: [displayPath(project.root, manifestPath)]
	};
}
function hasCapabilitiesDependency(root) {
	try {
		const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
		return Boolean(packageJson.dependencies?.["@pracht/capabilities"] ?? packageJson.devDependencies?.["@pracht/capabilities"]);
	} catch {
		return true;
	}
}
function generateApi(args, project) {
	const endpointPath = normalizeApiPath(args.path);
	const methods = parseApiMethods(args.methods);
	const apiFile = resolveApiModulePath(project, endpointPath);
	writeGeneratedFile(apiFile.absolutePath, buildApiRouteSource({
		endpointPath,
		methods
	}));
	return {
		created: [displayPath(project.root, apiFile.absolutePath)],
		kind: "api",
		updated: []
	};
}
//#endregion
export { generateShell as a, generateRoute as i, generateCapability as n, generate_exports as o, generateMiddleware as r, generateApi as t };
