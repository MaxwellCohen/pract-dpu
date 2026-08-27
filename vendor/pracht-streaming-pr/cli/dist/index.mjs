import { defineCommand, runMain } from "citty";
import { readFileSync } from "node:fs";
//#region src/constants.ts
const VERSION = readPackageVersion();
function readPackageVersion() {
	try {
		return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")).version ?? "0.0.0";
	} catch {
		return "0.0.0";
	}
}
const PROJECT_DEFAULTS = {
	additionalExtensions: [],
	apiDir: "/src/api",
	appFile: "/src/routes.ts",
	capabilitiesDir: "/src/capabilities",
	middlewareDir: "/src/middleware",
	pagesDefaultRender: "ssr",
	pagesDir: "",
	routesDir: "/src/routes",
	serverDir: "/src/server",
	shellsDir: "/src/shells"
};
const HTTP_METHODS = new Set([
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"HEAD",
	"OPTIONS"
]);
//#endregion
//#region src/index.ts
if (process.argv.includes("--version") || process.argv.includes("-v")) {
	console.log(VERSION);
	process.exit(0);
}
runMain(defineCommand({
	meta: {
		name: "pracht",
		version: VERSION,
		description: "The pracht CLI"
	},
	subCommands: {
		build: () => import("./build-NoLjhmns.mjs").then((n) => n.t).then((m) => m.default),
		dev: () => import("./dev-BJqny6NI.mjs").then((m) => m.default),
		doctor: () => import("./doctor-BZIyKaGP.mjs").then((m) => m.default),
		eval: () => import("./eval-OtappeXD.mjs").then((m) => m.default),
		generate: () => import("./generate-vKZ__lza.mjs").then((n) => n.o).then((m) => m.default),
		inspect: () => import("./inspect-B_0KqO5L.mjs").then((n) => n.t).then((m) => m.default),
		llms: () => import("./llms-CYmsNRac.mjs").then((m) => m.default),
		mcp: () => import("./mcp-C9pqnsow.mjs").then((m) => m.default),
		plan: () => import("./plan-cXvLMKiH.mjs").then((n) => n.r).then((m) => m.default),
		preview: () => import("./preview-W12fgmcs.mjs").then((n) => n.n).then((m) => m.default),
		report: () => import("./report-Bnon9gjy.mjs").then((n) => n.t).then((m) => m.default),
		typegen: () => import("./typegen-DI4BSR5Y.mjs").then((n) => n.a).then((m) => m.default),
		verify: () => import("./verify-Bz7oG4mI.mjs").then((m) => m.default)
	}
}));
//#endregion
export { PROJECT_DEFAULTS as n, VERSION as r, HTTP_METHODS as t };
