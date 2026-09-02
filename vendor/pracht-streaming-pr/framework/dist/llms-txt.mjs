import { withBase } from "./base.mjs";
import { buildPathFromSegments } from "./route-matching.mjs";
import { matchRoutePattern } from "./constraints.mjs";
import { resolveRegistryModule } from "./runtime-manifest.mjs";
import { API_METHOD_ORDER } from "./app-graph.mjs";
import { hasMarkdownRepresentation } from "./runtime-negotiation.mjs";
/**
* Path segments pracht reserves for its own endpoints. `/api/_pracht/image` is
* the image-optimization handler the `@pracht/image` loaders post to, and
* `/__pracht/*` covers the revalidation webhook and devtools. They are
* framework plumbing, not part of the app's agent surface, so listing them
* invites agents to call endpoints that are not theirs to call. Users cannot
* be expected to exclude them by hand in every app.
*/
const RESERVED_PATH_SEGMENTS = new Set(["_pracht", "__pracht"]);
function isReservedPath(path) {
	return path.split("/").some((segment) => RESERVED_PATH_SEGMENTS.has(segment));
}
async function buildLlmsTxt(options) {
	const include = options.include ?? [
		"pages",
		"api",
		"capabilities"
	];
	const origin = options.origin?.replace(/\/$/, "") ?? "";
	const maxPagesPerRoute = options.maxPagesPerRoute ?? 50;
	if (!Number.isInteger(maxPagesPerRoute) || maxPagesPerRoute < 0) throw new Error(`Invalid llmsTxt.maxPagesPerRoute: expected a non-negative integer (0 lists every page), got ${JSON.stringify(maxPagesPerRoute)}.`);
	const link = (path) => `${origin}${withBase(path)}`;
	const excludesPattern = createExcludeMatcher(options.exclude);
	const isExcluded = (path) => isReservedPath(path) || excludesPattern(path);
	const lines = [`# ${options.title}`];
	if (options.description) lines.push("", `> ${options.description}`);
	if (include.includes("pages")) {
		const collected = await collectPageEntries(options.app.routes, options.registry, {
			isExcluded,
			maxPagesPerRoute
		});
		if (collected.pages.length > 0) {
			if (collected.truncated.length > 0) lines.push("", ...collected.truncated.map(formatTruncationNote));
			lines.push("", "## Pages", "");
			for (const page of collected.pages) {
				const note = page.markdown ? ": supports `Accept: text/markdown`" : "";
				lines.push(`- [${page.path}](${link(page.path)})${note}`);
			}
		}
	}
	if (include.includes("api")) {
		const apiEntries = (await collectApiEntries(options.apiRoutes ?? [], options.registry)).filter((entry) => !isExcluded(entry.path));
		if (apiEntries.length > 0) {
			lines.push("", "## API", "");
			for (const entry of apiEntries) {
				const note = entry.methods.length > 0 ? `: ${entry.methods.join(", ")}` : "";
				lines.push(`- [${entry.path}](${link(entry.path)})${note}`);
			}
		}
	}
	if (include.includes("capabilities")) {
		const capabilityEntries = (await collectCapabilityEntries(options.app, options.registry)).filter((entry) => !isExcluded(entry.path));
		if (capabilityEntries.length > 0) {
			lines.push("", "## Capabilities", "");
			for (const entry of capabilityEntries) {
				const confirmation = entry.effect === "destructive" ? ", requires confirmation" : "";
				const description = entry.description ? ` — ${entry.description}` : "";
				lines.push(`- [${entry.name}](${link(entry.path)}): POST (${entry.effect}${confirmation})${description}`);
			}
		}
	}
	return `${lines.join("\n")}\n`;
}
/**
* The sentence that keeps a capped listing from reading as a complete one.
*
* It states the ratio rather than only the remainder because it sits above the
* section it describes: "N more are not listed" has no antecedent when it is
* the first line of the file. The verb agrees with the count, so a single
* omitted page does not read "1 more page ... are not listed".
*/
function formatTruncationNote(truncated) {
	const one = truncated.omitted === 1;
	return `_Pages lists ${truncated.listed} of ${truncated.listed + truncated.omitted} prerendered URLs under \`${truncated.routePath}\`; ${truncated.omitted} ${one ? "is" : "are"} omitted. Raise \`llmsTxt.maxPagesPerRoute\` to include ${one ? "it" : "them"}._`;
}
/**
* Validate every pattern up front, not on first use.
*
* `matchRoutePattern` throws for an invalid pattern only when it evaluates it,
* and `Array.some` short-circuits — so a bad pattern behind a matching one
* stayed silent until an unrelated route was added, then failed the build.
* The rewritten message names `llmsTxt.exclude` rather than sending the user
* to `defineApp({ constraints })`.
*/
function createExcludeMatcher(patterns) {
	if (!patterns || patterns.length === 0) return () => false;
	for (const pattern of patterns) {
		if (pattern === "") throw new Error("Invalid llmsTxt.exclude pattern: empty string. Remove it, or use \"/\" to exclude the homepage.");
		if (!pattern.startsWith("/") && pattern !== "**") throw new Error(`Invalid llmsTxt.exclude pattern ${JSON.stringify(pattern)}: patterns are absolute and must start with "/" (or be "**" to match everything).`);
		const segments = pattern.split("/").filter(Boolean);
		const wildcardIndex = segments.indexOf("**");
		if (wildcardIndex !== -1 && wildcardIndex !== segments.length - 1) throw new Error(`Invalid llmsTxt.exclude pattern ${JSON.stringify(pattern)}: "**" is only supported as the final segment. Patterns use the same segment globs as defineApp({ constraints }) — "*" matches exactly one segment and a trailing "**" matches the rest.`);
	}
	return (path) => patterns.some((pattern) => matchRoutePattern(pattern, path));
}
function isDynamicRoute(route) {
	return route.segments.some((segment) => segment.type === "param" || segment.type === "catchall");
}
/** Locale-independent path ordering so output is byte-stable across machines. */
function comparePaths(left, right) {
	if (left === right) return 0;
	return left < right ? -1 : 1;
}
async function loadRouteModule(registry, file) {
	try {
		return await resolveRegistryModule(registry?.routeModules, file);
	} catch {
		return;
	}
}
async function collectPageEntries(routes, registry, options) {
	const entries = /* @__PURE__ */ new Map();
	const truncated = [];
	for (const route of routes) {
		const routeModule = await loadRouteModule(registry, route.file);
		const markdown = hasMarkdownRepresentation(route, routeModule);
		if (!isDynamicRoute(route)) {
			if (!options.isExcluded(route.path) && !entries.has(route.path)) entries.set(route.path, {
				markdown,
				path: route.path
			});
			continue;
		}
		if (route.render !== "ssg" && route.render !== "isg") continue;
		if (typeof routeModule?.getStaticPaths !== "function") continue;
		let paramSets;
		try {
			paramSets = await routeModule.getStaticPaths();
		} catch {
			continue;
		}
		const seen = /* @__PURE__ */ new Set();
		const paths = [];
		for (const params of paramSets) {
			const path = buildPathFromSegments(route.segments, params);
			if (options.isExcluded(path) || entries.has(path) || seen.has(path)) continue;
			seen.add(path);
			paths.push(path);
		}
		const limit = options.maxPagesPerRoute > 0 ? options.maxPagesPerRoute : paths.length;
		if (paths.length > limit) truncated.push({
			listed: limit,
			omitted: paths.length - limit,
			routePath: route.path
		});
		for (const path of paths.slice(0, limit)) entries.set(path, {
			markdown,
			path
		});
	}
	return {
		pages: [...entries.values()].sort((left, right) => comparePaths(left.path, right.path)),
		truncated
	};
}
async function collectApiEntries(apiRoutes, registry) {
	const entries = [];
	for (const route of apiRoutes) {
		let apiModule;
		try {
			apiModule = await resolveRegistryModule(registry?.apiModules, route.file);
		} catch {
			apiModule = void 0;
		}
		const methods = apiModule ? API_METHOD_ORDER.filter((method) => typeof apiModule[method] === "function") : [];
		entries.push({
			methods,
			path: route.path
		});
	}
	return entries.sort((left, right) => comparePaths(left.path, right.path));
}
async function collectCapabilityEntries(app, registry) {
	if (!registry?.capabilityModules) return [];
	if (Object.keys(app.capabilities ?? {}).length === 0) return [];
	if (typeof __PRACHT_AGENT_SURFACE__ !== "undefined" && !__PRACHT_AGENT_SURFACE__) return [];
	const { resolveAppCapabilities } = await import("./runtime-capabilities.mjs");
	const resolved = await resolveAppCapabilities(app, registry);
	const entries = [];
	for (const { name, capability, httpPath } of resolved) {
		if (!httpPath) continue;
		entries.push({
			description: capability.description ?? "",
			effect: capability.effect,
			name,
			path: httpPath
		});
	}
	return entries.sort((left, right) => comparePaths(left.name, right.name));
}
//#endregion
export { buildLlmsTxt };
