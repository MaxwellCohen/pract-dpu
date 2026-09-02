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
		build: () => import("./build-BTrv4ZNf.mjs").then((n) => n.t).then((m) => m.default),
		dev: () => import("./dev-BnZ-uMd2.mjs").then((m) => m.default),
		doctor: () => import("./doctor-BJJodPUi.mjs").then((m) => m.default),
		eval: () => import("./eval-g-Qoor09.mjs").then((m) => m.default),
		generate: () => import("./generate-BqQ17MhF.mjs").then((n) => n.o).then((m) => m.default),
		inspect: () => import("./inspect-BepW0Qs9.mjs").then((n) => n.t).then((m) => m.default),
		llms: () => import("./llms-COJ9Tz3Q.mjs").then((m) => m.default),
		mcp: () => import("./mcp-XvEAUd-K.mjs").then((m) => m.default),
		plan: () => import("./plan-CONnOB3b.mjs").then((n) => n.r).then((m) => m.default),
		preview: () => import("./preview-DoGo6ljG.mjs").then((n) => n.n).then((m) => m.default),
		report: () => import("./report-Cli5wivd.mjs").then((n) => n.t).then((m) => m.default),
		typegen: () => import("./typegen-q813DPhU.mjs").then((n) => n.a).then((m) => m.default),
		verify: () => import("./verify-B3iK9fL7.mjs").then((m) => m.default)
	}
}));
//#endregion
export { PROJECT_DEFAULTS as n, VERSION as r, HTTP_METHODS as t };
