import { PRACHT_BASE, stripBase, withBase } from "./base.mjs";
import { buildHref, buildPathFromSegments } from "./route-matching.mjs";
import { defineApp, group, matchAppRoute, resolveApp, route, timeRevalidate, webhookRevalidate } from "./app.mjs";
import { forbidRenderMode, matchRoutePattern, requireHead, requireMiddleware, requireRenderMode, requireShell } from "./constraints.mjs";
import { createHref } from "./href.mjs";
import { defineFont } from "./font.mjs";
import { apiValidationErrorResponse, defineApi, formDataToRecord, isApiValidationErrorBody, json, searchParamsToRecord, validateStandardSchema } from "./api-validation.mjs";
import { ApiFetchError, apiFetch } from "./api-fetch.mjs";
import { PRACHT_PUBLIC_ENV_PREFIX, filterPublicEnv, publicEnv } from "./env.mjs";
import { fetchPrachtRouteState, parseSafeNavigationUrl } from "./runtime-client-fetch.mjs";
import { redirect } from "./runtime-middleware.mjs";
import { createUseCapability } from "./capability-hook.mjs";
import { defer, use } from "./defer.mjs";
import { PrachtRuntimeProvider, readHydrationState, startApp } from "./runtime-context.mjs";
import { ensureCapabilityRevalidation } from "./runtime-capability-revalidate.mjs";
import { createEventStream, serializeEventStreamMessage } from "./event-stream.mjs";
import { isUpgradeRequest } from "./upgrade.mjs";
import { useEventSource } from "./event-source-hook.mjs";
import { forwardRef } from "./forwardRef.mjs";
import { useIsHydrated } from "./hydration.mjs";
import { Script } from "./script.mjs";
import { Suspense, lazy } from "./suspense.mjs";
import { ErrorBoundary } from "./error-boundary.mjs";
import { Form, Link, useLocation, useNavigation, useParams, useRevalidate, useRouteData, useSearchParams } from "./runtime-hooks.mjs";
import { prefetch } from "./prefetch-api.mjs";
import { initClientRouter, useNavigate } from "./router.mjs";
import { PrachtHttpError, notFound } from "./types.mjs";
//#region src/browser.ts
/**
* Browser stub for the server-only `invokeCapability()`. Route modules import
* it for their loaders; the client transform strips the loader, but the named
* import can survive when the statement also imports client hooks. This stub
* keeps the capability pipeline out of client bundles and fails loudly if it
* is ever called in the browser.
*/
async function invokeCapability() {
	throw new Error("invokeCapability() is server-only. In the browser, call the HTTP projection via callCapability from \"virtual:pracht/capabilities\" instead.");
}
/** Browser stub for the server-only `createCapabilityTestHost()` — see above. */
function createCapabilityTestHost() {
	throw new Error("createCapabilityTestHost() is server-only. Import it in Node-based tests, not in browser code.");
}
//#endregion
export { ApiFetchError, ErrorBoundary, Form, Link, PRACHT_BASE, PRACHT_PUBLIC_ENV_PREFIX, PrachtHttpError, PrachtRuntimeProvider, Script, Suspense, apiFetch, apiValidationErrorResponse, buildHref, buildPathFromSegments, createCapabilityTestHost, createEventStream, createHref, createUseCapability, defer, defineApi, defineApp, defineFont, ensureCapabilityRevalidation, fetchPrachtRouteState, filterPublicEnv, forbidRenderMode, formDataToRecord, forwardRef, group, initClientRouter, invokeCapability, isApiValidationErrorBody, isUpgradeRequest, json, lazy, matchAppRoute, matchRoutePattern, notFound, parseSafeNavigationUrl, prefetch, publicEnv, readHydrationState, redirect, requireHead, requireMiddleware, requireRenderMode, requireShell, resolveApp, route, searchParamsToRecord, serializeEventStreamMessage, startApp, stripBase, timeRevalidate, use, useEventSource, useIsHydrated, useLocation, useNavigate, useNavigation, useParams, useRevalidate, useRouteData, useSearchParams, validateStandardSchema, webhookRevalidate, withBase };
