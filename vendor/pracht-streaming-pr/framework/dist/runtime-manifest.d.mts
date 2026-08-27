import { ModuleImporter } from "./types.mjs";

//#region src/runtime-manifest.d.ts
declare function resolveRegistryModule<T>(modules: Record<string, ModuleImporter> | undefined, file: string): Promise<T | undefined>;
//#endregion
export { resolveRegistryModule };