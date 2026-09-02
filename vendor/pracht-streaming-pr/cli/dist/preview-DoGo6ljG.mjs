import { t as __exportAll } from "./rolldown-runtime-wcPFST8Q.mjs";
import { n as runBuild } from "./build-BTrv4ZNf.mjs";
import { a as readProjectConfig, v as requirePositiveInteger } from "./project-C-2I9C0N.mjs";
import { defineCommand } from "citty";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
//#region src/wrangler-config.ts
/**
* Wrangler's own lookup order (`wrangler.json` wins over `wrangler.jsonc`,
* which wins over `wrangler.toml`). Anything that reasons about "the config
* wrangler will load" has to agree with this exactly, or it reports on a file
* the deploy never reads.
*/
const WRANGLER_CONFIG_FILES = [
	"wrangler.json",
	"wrangler.jsonc",
	"wrangler.toml"
];
function findWranglerConfig(root) {
	for (const name of WRANGLER_CONFIG_FILES) {
		const candidate = resolve(root, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}
/**
* Every `main` a wrangler config declares: the top-level one plus each
* `env.<name>.main` override, since `main` is inheritable per environment and
* `wrangler deploy --env <name>` ships the override.
*
* Returns an empty array when the file cannot be read or parsed — callers
* report on what they can prove, never on a guess.
*/
function readWranglerMainEntries(configFile) {
	let source;
	try {
		source = readFileSync(configFile, "utf-8");
	} catch {
		return [];
	}
	return configFile.endsWith(".toml") ? readTomlMainEntries(source) : readJsonMainEntries(source);
}
/**
* The effective settings that preserve Vite's server chunks for the default
* deployment and every named environment that overrides them, or `null` when
* the file cannot be parsed conservatively. `no_bundle` prevents Wrangler
* from folding the chunks into its entry, while the ESModule rule makes
* Wrangler upload the `.js` files next to that entry.
*/
function readWranglerBundleSettings(configFile) {
	let source;
	try {
		source = readFileSync(configFile, "utf-8");
	} catch {
		return null;
	}
	if (configFile.endsWith(".toml")) {
		const createScope = () => ({
			hasNoBundleOverride: false,
			hasRulesOverride: false,
			hasJavaScriptModuleRule: false,
			noBundle: void 0
		});
		const root = createScope();
		const environments = /* @__PURE__ */ new Map();
		const environmentScope = (name) => {
			const scope = environments.get(name) ?? createScope();
			environments.set(name, scope);
			return scope;
		};
		let settingsScope = root;
		let ruleScope;
		let ruleType;
		let ruleGlobs = [];
		const finishRule = () => {
			if (ruleScope && ruleType === "ESModule" && ruleGlobs.includes("**/*.js")) ruleScope.hasJavaScriptModuleRule = true;
			ruleScope = void 0;
			ruleType = void 0;
			ruleGlobs = [];
		};
		for (const line of source.split(/\r?\n/)) {
			const tableMatch = TOML_TABLE_RE.exec(line);
			if (tableMatch) {
				finishRule();
				settingsScope = void 0;
				const table = tableMatch[1];
				if (table === "rules") {
					root.hasRulesOverride = true;
					ruleScope = root;
					continue;
				}
				const environment = /^env\s*\.\s*([^.\s]+)$/.exec(table)?.[1];
				if (environment) {
					settingsScope = environmentScope(environment);
					continue;
				}
				const environmentRules = /^env\s*\.\s*([^.\s]+)\s*\.\s*rules$/.exec(table)?.[1];
				if (environmentRules) {
					ruleScope = environmentScope(environmentRules);
					ruleScope.hasRulesOverride = true;
				}
				continue;
			}
			if (settingsScope) {
				const match = /^\s*no_bundle\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line);
				if (match) {
					settingsScope.hasNoBundleOverride = true;
					settingsScope.noBundle = match[1] === "true";
					continue;
				}
				if (/^\s*rules\s*=/.test(line)) settingsScope.hasRulesOverride = true;
			}
			if (!ruleScope) {
				const dotted = /^\s*env\s*\.\s*([^.\s]+)\s*\.\s*no_bundle\s*=\s*(true|false)\s*(?:#.*)?$/.exec(line);
				if (dotted) {
					const scope = environmentScope(dotted[1]);
					scope.hasNoBundleOverride = true;
					scope.noBundle = dotted[2] === "true";
				}
				continue;
			}
			const typeMatch = new RegExp(String.raw`^\s*type\s*=\s*${TOML_VALUE}\s*(?:#.*)?$`).exec(line);
			if (typeMatch) {
				ruleType = typeMatch[1] ?? typeMatch[2];
				continue;
			}
			const globsMatch = /^\s*globs\s*=\s*\[(.*)\]\s*(?:#.*)?$/.exec(line);
			if (globsMatch) ruleGlobs = readTomlStringArray(globsMatch[1]);
		}
		finishRule();
		return [{
			environment: null,
			noBundle: root.noBundle,
			hasJavaScriptModuleRule: root.hasJavaScriptModuleRule
		}, ...[...environments.entries()].filter(([, scope]) => scope.hasNoBundleOverride || scope.hasRulesOverride).map(([environment, scope]) => ({
			environment,
			noBundle: scope.hasNoBundleOverride ? scope.noBundle : root.noBundle,
			hasJavaScriptModuleRule: scope.hasRulesOverride ? scope.hasJavaScriptModuleRule : root.hasJavaScriptModuleRule
		}))];
	}
	let config;
	try {
		config = JSON.parse(stripJsonComments(source).replace(/,(\s*[}\]])/g, "$1"));
	} catch {
		return null;
	}
	if (!config || typeof config !== "object") return null;
	const root = config;
	const value = root.no_bundle;
	const rules = root.rules;
	const hasJavaScriptModuleRule = (candidateRules) => Array.isArray(candidateRules) && candidateRules.some((rule) => {
		if (!rule || typeof rule !== "object") return false;
		const candidate = rule;
		return candidate.type === "ESModule" && Array.isArray(candidate.globs) && candidate.globs.includes("**/*.js");
	});
	const settings = [{
		environment: null,
		noBundle: typeof value === "boolean" ? value : void 0,
		hasJavaScriptModuleRule: hasJavaScriptModuleRule(rules)
	}];
	const environments = root.env;
	if (environments && typeof environments === "object") for (const [environment, entry] of Object.entries(environments)) {
		if (!entry || typeof entry !== "object") continue;
		const candidate = entry;
		if (!Object.hasOwn(candidate, "no_bundle") && !Object.hasOwn(candidate, "rules")) continue;
		const environmentNoBundle = candidate.no_bundle;
		settings.push({
			environment,
			noBundle: Object.hasOwn(candidate, "no_bundle") ? typeof environmentNoBundle === "boolean" ? environmentNoBundle : void 0 : typeof value === "boolean" ? value : void 0,
			hasJavaScriptModuleRule: hasJavaScriptModuleRule(Object.hasOwn(candidate, "rules") ? candidate.rules : rules)
		});
	}
	return settings;
}
function readTomlStringArray(source) {
	const values = [];
	for (const match of source.matchAll(/"([^"]*)"|'([^']*)'/g)) values.push(match[1] ?? match[2]);
	return values;
}
/**
* The top-level `assets.html_handling` value, or `null` when it cannot be
* proven — an unreadable file, a parse failure, a TOML config (not parsed
* here), or no `assets` block at all.
*
* `null` means "unknown", never "fine": callers must stay silent on it rather
* than reporting a config they could not read.
*/
function readWranglerAssetsHtmlHandling(configFile) {
	if (configFile.endsWith(".toml")) return null;
	let source;
	try {
		source = readFileSync(configFile, "utf-8");
	} catch {
		return null;
	}
	let config;
	try {
		config = JSON.parse(stripJsonComments(source).replace(/,(\s*[}\]])/g, "$1"));
	} catch {
		return null;
	}
	if (!config || typeof config !== "object") return null;
	const assets = config.assets;
	if (!assets || typeof assets !== "object") return null;
	const htmlHandling = assets.html_handling;
	return { htmlHandling: typeof htmlHandling === "string" ? htmlHandling : void 0 };
}
function readJsonMainEntries(source) {
	let config;
	try {
		config = JSON.parse(stripJsonComments(source).replace(/,(\s*[}\]])/g, "$1"));
	} catch {
		return [];
	}
	if (!config || typeof config !== "object") return [];
	const entries = [];
	const root = config;
	if (typeof root.main === "string") entries.push({
		environment: null,
		main: root.main
	});
	const env = root.env;
	if (env && typeof env === "object") {
		for (const [name, value] of Object.entries(env)) if (value && typeof value === "object") {
			const main = value.main;
			if (typeof main === "string") entries.push({
				environment: name,
				main
			});
		}
	}
	return entries;
}
/** Removes `//` and block comments without touching comment-like text inside strings. */
function stripJsonComments(source) {
	let out = "";
	let inString = false;
	let inLineComment = false;
	let inBlockComment = false;
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		const next = source[i + 1];
		if (inLineComment) {
			if (char === "\n") {
				inLineComment = false;
				out += char;
			}
			continue;
		}
		if (inBlockComment) {
			if (char === "*" && next === "/") {
				inBlockComment = false;
				i++;
			}
			continue;
		}
		if (inString) {
			out += char;
			if (char === "\\") {
				out += next ?? "";
				i++;
			} else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			out += char;
			continue;
		}
		if (char === "/" && next === "/") {
			inLineComment = true;
			i++;
			continue;
		}
		if (char === "/" && next === "*") {
			inBlockComment = true;
			i++;
			continue;
		}
		out += char;
	}
	return out;
}
const TOML_TABLE_RE = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;
const TOML_VALUE = String.raw`(?:"([^"]*)"|'([^']*)')`;
const TOML_MAIN_RE = new RegExp(String.raw`^\s*main\s*=\s*${TOML_VALUE}\s*(?:#.*)?$`);
const TOML_DOTTED_ENV_MAIN_RE = new RegExp(String.raw`^\s*env\s*\.\s*([^.\s]+)\s*\.\s*main\s*=\s*${TOML_VALUE}\s*(?:#.*)?$`);
function readTomlMainEntries(source) {
	const entries = [];
	let table = null;
	for (const line of source.split(/\r?\n/)) {
		const tableMatch = TOML_TABLE_RE.exec(line);
		if (tableMatch) {
			table = tableMatch[1];
			continue;
		}
		if (table === null) {
			const dotted = TOML_DOTTED_ENV_MAIN_RE.exec(line);
			if (dotted) {
				entries.push({
					environment: dotted[1],
					main: dotted[2] ?? dotted[3]
				});
				continue;
			}
		}
		const mainMatch = TOML_MAIN_RE.exec(line);
		if (!mainMatch) continue;
		const main = mainMatch[1] ?? mainMatch[2];
		if (table === null) {
			entries.push({
				environment: null,
				main
			});
			continue;
		}
		const envMatch = /^env\s*\.\s*([^.\s]+)$/.exec(table);
		if (envMatch) entries.push({
			environment: envMatch[1],
			main
		});
	}
	return entries;
}
//#endregion
//#region src/commands/preview.ts
var preview_exports = /* @__PURE__ */ __exportAll({
	default: () => preview_default,
	detectAdapterTarget: () => detectAdapterTarget,
	normalizeAdapterTarget: () => normalizeAdapterTarget,
	resolveWranglerBin: () => resolveWranglerBin
});
const SERVER_ENTRY = "dist/server/server.js";
const ADAPTER_TARGETS = new Set([
	"cloudflare",
	"netlify",
	"node",
	"static",
	"vercel"
]);
var preview_default = defineCommand({
	meta: {
		name: "preview",
		description: "Build and serve the production build locally"
	},
	args: {
		port: {
			type: "string",
			description: "Port number (defaults to $PORT or 3000)"
		},
		"skip-build": {
			type: "boolean",
			description: "Serve the existing build output without rebuilding"
		}
	},
	async run({ args }) {
		const root = process.cwd();
		const project = readProjectConfig(root);
		if (!project.configFile) throw new Error("Missing vite config. `pracht preview` requires a project with pracht configured.");
		if (!project.hasPrachtPlugin) throw new Error("vite.config does not appear to register the pracht plugin.");
		const skipBuild = Boolean(args["skip-build"]);
		let target = skipBuild ? await readBuildTarget(root) : null;
		target ??= detectAdapterTarget(project);
		if (target === "netlify" || target === "vercel") {
			printPlatformGuidance(target);
			process.exitCode = 1;
			return;
		}
		const port = requirePositiveInteger(args.port ?? process.env.PORT, "port", 3e3);
		if (!skipBuild) {
			const { buildTarget } = await runBuild(root);
			target = normalizeAdapterTarget(buildTarget) ?? target;
			if (target === "netlify" || target === "vercel") {
				printPlatformGuidance(target);
				process.exitCode = 1;
				return;
			}
		}
		const serverEntry = resolve(root, SERVER_ENTRY);
		if (!existsSync(serverEntry)) throw new Error(`Missing ${SERVER_ENTRY}. Run \`pracht build\` first, or drop --skip-build to build automatically.`);
		if (target === "cloudflare") {
			const wranglerBin = resolveWranglerBin(root);
			if (!wranglerBin) throw new Error(["`pracht preview` needs wrangler to serve Cloudflare builds, but it was not found in node_modules or on your PATH.", "Install it with `npm install --save-dev wrangler` (or `pnpm add -D wrangler`) and re-run `pracht preview`."].join("\n"));
			if (!findWranglerConfig(root)) throw new Error(["`pracht preview` needs a wrangler config (wrangler.jsonc, wrangler.json, or wrangler.toml) pointing at the built worker.", "Create one with `\"main\": \"dist/server/worker.js\"` — see docs/ADAPTERS.md for a full example."].join("\n"));
			console.log(`\n  Previewing Cloudflare build with wrangler dev on port ${port}...\n`);
			spawnPreviewProcess(wranglerBin, [
				"dev",
				"--port",
				String(port)
			], { cwd: root });
			return;
		}
		if (target === "static") console.log(`\n  Previewing static export (dist/client) → http://localhost:${port}\n  Production deploys need no server: upload dist/client to any static host.
`);
		else console.log(`\n  Previewing production build → http://localhost:${port}\n`);
		spawnPreviewProcess(process.execPath, [serverEntry], {
			cwd: root,
			env: {
				...process.env,
				PORT: String(port)
			}
		});
	}
});
function detectAdapterTarget(project) {
	const source = project.rawConfig;
	if (/\bcloudflareAdapter\s*\(/.test(source) || source.includes("@pracht/adapter-cloudflare")) return "cloudflare";
	if (/\bvercelAdapter\s*\(/.test(source) || source.includes("@pracht/adapter-vercel")) return "vercel";
	if (/\bnetlifyAdapter\s*\(/.test(source) || source.includes("@pracht/adapter-netlify")) return "netlify";
	if (/\bstaticAdapter\s*\(/.test(source) || source.includes("@pracht/adapter-static")) return "static";
	return "node";
}
function normalizeAdapterTarget(value) {
	return typeof value === "string" && ADAPTER_TARGETS.has(value) ? value : null;
}
function resolveWranglerBin(root, env = process.env) {
	const binNames = process.platform === "win32" ? [
		"wrangler.cmd",
		"wrangler.exe",
		"wrangler"
	] : ["wrangler"];
	const searchDirs = [resolve(root, "node_modules/.bin"), ...(env.PATH ?? "").split(delimiter).filter(Boolean)];
	for (const dir of searchDirs) for (const name of binNames) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}
async function readBuildTarget(root) {
	const serverEntry = resolve(root, SERVER_ENTRY);
	if (!existsSync(serverEntry)) return null;
	try {
		return normalizeAdapterTarget((await import(pathToFileURL(serverEntry).href)).buildTarget);
	} catch {
		return null;
	}
}
function printPlatformGuidance(target) {
	if (target === "netlify") {
		console.log([
			"",
			"  The Netlify adapter relies on Netlify Functions and CDN behavior, so `pracht preview` does not emulate it.",
			"",
			"  Use Netlify's own local runtime instead:",
			"",
			"    pracht build && netlify dev",
			"",
			"  To build and deploy with the configured Netlify project, run: netlify deploy --build --prod",
			""
		].join("\n"));
		return;
	}
	console.log([
		"",
		"  The Vercel adapter has no faithful local production runtime, so `pracht preview` does not emulate it.",
		"",
		"  To exercise the Vercel build output locally, use Vercel's own tooling:",
		"",
		"    vercel build   # reproduce the production build (.vercel/output) with your project settings",
		"    vercel dev     # run a local Vercel development environment",
		"",
		"  To ship the output of `pracht build`, run: vercel deploy --prebuilt",
		""
	].join("\n"));
}
function spawnPreviewProcess(command, commandArgs, options) {
	const child = spawn(command, commandArgs, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		stdio: "inherit"
	});
	child.on("close", (code) => {
		process.exitCode = code ?? 0;
	});
	child.on("error", (error) => {
		console.error(`Failed to start preview process: ${error.message}`);
		process.exitCode = 1;
	});
}
//#endregion
export { readWranglerBundleSettings as a, readWranglerAssetsHtmlHandling as i, preview_exports as n, readWranglerMainEntries as o, findWranglerConfig as r, detectAdapterTarget as t };
