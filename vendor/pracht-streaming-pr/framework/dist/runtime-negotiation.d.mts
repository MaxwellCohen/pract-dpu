//#region src/runtime-negotiation.d.ts
declare const MARKDOWN_MEDIA_TYPE = "text/markdown";
type MarkdownManifest = Record<string, true>;
declare function prefersMarkdown(accept: string | null): boolean;
/** Whether the build recorded a raw Markdown representation for this route. */
declare function routeSupportsMarkdown(markdownManifest: MarkdownManifest, pathname: string): boolean;
declare function markdownResponse(source: string, initHeaders?: HeadersInit, status?: number): Response;
//#endregion
export { MARKDOWN_MEDIA_TYPE, MarkdownManifest, markdownResponse, prefersMarkdown, routeSupportsMarkdown };