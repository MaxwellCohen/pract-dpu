import { CONFIRMATION_HEADER as CONFIRMATION_HEADER$1, CONFIRMATION_SECRET_ENV } from "@pracht/capabilities";

//#region src/runtime-confirmation.d.ts
/**
 * Configure the confirmation secret at runtime — for platforms where
 * `process.env` is unavailable (e.g. Cloudflare Workers without
 * `nodejs_compat`). Takes precedence over the environment variable.
 */
declare function setCapabilityConfirmationSecret(secret: string | null): void;
//#endregion
export { CONFIRMATION_HEADER$1 as CONFIRMATION_HEADER, CONFIRMATION_SECRET_ENV, setCapabilityConfirmationSecret };