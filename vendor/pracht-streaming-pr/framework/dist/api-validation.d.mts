import { ApiRouteArgs, HttpMethod, MaybePromise, RegisteredContext, RouteParams } from "./types.mjs";
import { StandardSchemaV1 } from "@standard-schema/spec";

//#region src/api-validation.d.ts
/** Which part of the request a validation issue belongs to. */
type ApiValidationSource = "body" | "query" | "params";
type ApiValidationPathSegment = string | number;
/**
 * One normalized validation issue, serialized into the 422 response body and
 * surfaced to `apiFetch()` / `<Form onValidationIssues>` on the client.
 */
interface ApiValidationIssue {
  in: ApiValidationSource;
  message: string;
  path?: ApiValidationPathSegment[];
}
/** JSON body of a validation failure response (HTTP 400/422). */
interface ApiValidationErrorBody {
  error: "validation";
  issues: ApiValidationIssue[];
}
declare function isApiValidationErrorBody(value: unknown): value is ApiValidationErrorBody;
/** Build the standardized validation failure response. */
declare function apiValidationErrorResponse(issues: ApiValidationIssue[], init?: {
  status?: number;
}): Response;
interface ApiRouteSchemas {
  body?: StandardSchemaV1;
  query?: StandardSchemaV1;
  params?: StandardSchemaV1;
}
/** Values that can cross the JSON response boundary without changing type. */
type ApiJsonPrimitive = string | number | boolean | null;
type ApiJsonValue = ApiJsonPrimitive | {
  readonly [key: string]: ApiJsonValue;
} | readonly ApiJsonValue[];
type JsonCompatible<T> = T extends ApiJsonPrimitive ? T : T extends bigint | symbol | undefined | ((...args: never[]) => unknown) ? never : T extends readonly unknown[] ? { [TKey in keyof T]: JsonCompatible<T[TKey]> } : T extends object ? { [TKey in keyof T]: JsonCompatible<T[TKey]> } : never;
type NonResponseResult<TResult> = Exclude<Awaited<TResult>, Response>;
/**
 * `Response` subtype produced by `json()`. Carries the payload type on a
 * type-only `"~payload"` marker (it never exists at runtime) so
 * `ApiHandlerOutput` can surface the payload to `apiFetch()` callers even
 * though the handler returns a `Response`.
 */
interface TypedJsonResponse<TPayload> extends Response {
  readonly "~payload": TPayload;
}
type JsonValueConstraint<TValue> = [TValue] extends [JsonCompatible<TValue>] ? unknown : {
  readonly "json() values must be JSON-safe": never;
};
/**
 * `Response.json()` with the payload type preserved for `apiFetch()` callers.
 * Use it when a handler needs a non-200 status or custom headers without
 * collapsing the client-side response type to `unknown`:
 *
 * ```ts
 * export const POST = defineApi({
 *   body: itemSchema,
 *   handler: ({ body }) => json({ created: body.name }, { status: 201 }),
 * });
 * ```
 */
declare function json<TValue>(value: TValue & JsonValueConstraint<NoInfer<TValue>>, init?: ResponseInit): TypedJsonResponse<TValue>;
type ApiHandlerResultConstraint<TResult> = [NonResponseResult<TResult>] extends [never] ? unknown : [NonResponseResult<TResult>] extends [JsonCompatible<NonResponseResult<TResult>>] ? unknown : {
  readonly "Handler return values must be JSON-safe or Response objects": never;
};
type InferSchemaOutput<TSchema> = TSchema extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<TSchema> : undefined;
type InferSchemaInput<TSchema> = TSchema extends StandardSchemaV1 ? StandardSchemaV1.InferInput<TSchema> : unknown;
/**
 * Handler args for `defineApi()`. Extends the regular API route args with the
 * validated `body` and `query` values; `params` stays the raw string record
 * unless a `params` schema replaces it with the schema's output.
 */
type ValidatedApiArgs<TBody = undefined, TQuery = undefined, TParams = RouteParams, TContext = RegisteredContext> = Omit<ApiRouteArgs<TContext>, "params"> & {
  body: TBody;
  query: TQuery;
  params: TParams;
};
type PlainResponseResult<TResult> = TResult extends TypedJsonResponse<any> ? never : Extract<TResult, Response>;
type TypedJsonPayload<TResult> = TResult extends TypedJsonResponse<infer TPayload> ? TPayload : never;
/**
 * JSON output type of a handler. `json()` responses carry their payload type;
 * any other `Response` branch keeps an `unknown` output because the payload
 * type cannot be recovered from the response status, headers, or body.
 */
type ApiHandlerOutput<TResult> = [PlainResponseResult<TResult>] extends [never] ? Exclude<TResult, Response> | TypedJsonPayload<TResult> : unknown;
/**
 * The callable produced by `defineApi()`. Compatible with the plain
 * `ApiRouteHandler` dispatch (`module[method](args)`), and carries the
 * request/response types on a type-only `~types` marker so
 * `ApiRouteMethodMap` (used by `pracht typegen`) can extract them.
 * The marker never exists at runtime.
 */
interface ValidatedApiHandler<TBody = unknown, TQuery = unknown, TOutput = unknown, TParams = unknown> {
  (args: ApiRouteArgs<any>): Promise<Response>;
  readonly schemas: ApiRouteSchemas;
  readonly "~types": {
    body: TBody;
    query: TQuery;
    output: TOutput;
    params: TParams;
  };
}
interface DefineApiConfig<TBodySchema extends StandardSchemaV1 | undefined, TQuerySchema extends StandardSchemaV1 | undefined, TParamsSchema extends StandardSchemaV1 | undefined, TResult, TContext> {
  /** Standard Schema for the request body (JSON or form submissions). */
  body?: TBodySchema;
  /** Standard Schema for the query string (values are strings or string arrays). */
  query?: TQuerySchema;
  /** Standard Schema for the route params (values are strings). */
  params?: TParamsSchema;
  handler: (args: ValidatedApiArgs<InferSchemaOutput<TBodySchema>, InferSchemaOutput<TQuerySchema>, TParamsSchema extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<TParamsSchema> : RouteParams, TContext>) => MaybePromise<TResult>;
}
type DefineApiHandler<TBodySchema extends StandardSchemaV1 | undefined, TQuerySchema extends StandardSchemaV1 | undefined, TParamsSchema extends StandardSchemaV1 | undefined, TContext, TResult = unknown> = DefineApiConfig<TBodySchema, TQuerySchema, TParamsSchema, TResult, TContext>["handler"];
/**
 * Define a validated API route handler.
 *
 * ```ts
 * // src/api/items.ts
 * import { defineApi } from "@pracht/core";
 * import * as z from "zod";
 *
 * export const POST = defineApi({
 *   body: z.object({ name: z.string() }),
 *   handler: ({ body }) => ({ created: body.name }),
 * });
 * ```
 *
 * The wrapper validates `body`, `query`, and `params` with any
 * [Standard Schema](https://standardschema.dev) validator before the handler
 * runs, and answers invalid requests with a 422 JSON body
 * (`{ error: "validation", issues }`). Handlers may return a `Response` for
 * full control, or a JSON-safe value whose type survives `Response.json()`.
 */
declare function defineApi<THandler extends DefineApiHandler<TBodySchema, TQuerySchema, TParamsSchema, TContext, any>, TBodySchema extends StandardSchemaV1 | undefined = undefined, TQuerySchema extends StandardSchemaV1 | undefined = undefined, TParamsSchema extends StandardSchemaV1 | undefined = undefined, TContext = RegisteredContext>(config: Omit<DefineApiConfig<TBodySchema, TQuerySchema, TParamsSchema, never, TContext>, "handler"> & {
  handler: THandler & ApiHandlerResultConstraint<NoInfer<ReturnType<THandler>>>;
}): ValidatedApiHandler<InferSchemaInput<TBodySchema>, InferSchemaInput<TQuerySchema>, ApiHandlerOutput<Awaited<ReturnType<THandler>>>, InferSchemaInput<TParamsSchema>>;
/**
 * Run a Standard Schema against a value and normalize the outcome: either the
 * validated value, or issues tagged with the request part they belong to.
 */
declare function validateStandardSchema(schema: StandardSchemaV1, value: unknown, source: ApiValidationSource): Promise<{
  issues: null;
  value: unknown;
} | {
  issues: ApiValidationIssue[];
  value?: never;
}>;
/**
 * Query values presented to the `query` schema: one string per key, or an
 * array of strings when the key repeats (`?tag=a&tag=b`).
 */
declare function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[]>;
/**
 * Form values presented to a schema: one entry per field, or an array when
 * the field repeats (multi-selects, checkbox groups). File fields stay `File`.
 */
declare function formDataToRecord(formData: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[]>;
/**
 * Extract `{ body, query, output, params }` from one exported handler. `defineApi()`
 * handlers carry precise types; plain handlers fall back to `unknown`.
 */
type ApiHandlerTypes<THandler> = THandler extends {
  readonly "~types": infer TTypes;
} ? TTypes : THandler extends ((...args: never[]) => infer TResult) ? {
  body: unknown;
  query: unknown;
  output: ApiHandlerOutput<Awaited<TResult>>;
  params: unknown;
} : never;
/**
 * Map an API route module's exported HTTP method handlers to their
 * request/response types. `pracht typegen` registers
 * `ApiRouteMethodMap<typeof import("./api/...")>` per route on
 * `Register["apiRoutes"]`, which `apiFetch()` reads for end-to-end types.
 */
type ApiRouteMethodMap<TModule> = { [TMethod in (HttpMethod | "default") & keyof TModule]: ApiHandlerTypes<TModule[TMethod]> };
//#endregion
export { ApiHandlerTypes, ApiJsonPrimitive, ApiJsonValue, ApiRouteMethodMap, ApiRouteSchemas, ApiValidationErrorBody, ApiValidationIssue, ApiValidationPathSegment, ApiValidationSource, DefineApiConfig, TypedJsonResponse, ValidatedApiArgs, ValidatedApiHandler, apiValidationErrorResponse, defineApi, formDataToRecord, isApiValidationErrorBody, json, searchParamsToRecord, validateStandardSchema };