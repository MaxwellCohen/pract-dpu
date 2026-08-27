import { VNode } from "preact";

//#region src/runtime-stream.d.ts
/** Whether a response body was created by Pracht's streaming document renderer. */
declare function isStreamingHtmlResponse(response: Response): boolean;
//#endregion
export { isStreamingHtmlResponse };