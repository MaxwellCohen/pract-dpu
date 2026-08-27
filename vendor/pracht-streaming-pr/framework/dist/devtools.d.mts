import { ApiRouteExports, AppGraph, AppGraphApiRoute, AppGraphCapability, AppGraphModuleAccess, AppGraphRoute, AppGraphStaticModuleAccess, SerializeApiRoutesOptions, SerializeCapabilitiesOptions, buildAppGraph, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities } from "./app-graph.mjs";

//#region src/devtools.d.ts
declare const DEVTOOLS_PATH = "/_pracht";
declare const DEVTOOLS_JSON_PATH = "/_pracht.json";
declare function buildDevtoolsHtml(graph: AppGraph, options?: {
  base?: string;
}): string;
//#endregion
export { type ApiRouteExports, type AppGraph, type AppGraphApiRoute, type AppGraphCapability, type AppGraphModuleAccess, type AppGraphRoute, type AppGraphStaticModuleAccess, DEVTOOLS_JSON_PATH, DEVTOOLS_PATH, type SerializeApiRoutesOptions, type SerializeCapabilitiesOptions, buildAppGraph, buildDevtoolsHtml, detectApiExports, detectApiExportsStatic, detectApiMethods, serializeApiRoutes, serializeApiRoutesStatic, serializeAppRoutes, serializeCapabilities };