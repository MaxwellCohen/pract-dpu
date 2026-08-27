//#region src/env-server.browser.d.ts
declare function setServerEnv(): void;
declare const serverEnv: Record<string, never>;
//#endregion
export { serverEnv, setServerEnv };