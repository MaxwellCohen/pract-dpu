//#region src/types.ts
var PrachtHttpError = class extends Error {
	status;
	constructor(status, message) {
		super(message);
		this.name = "PrachtHttpError";
		this.status = status;
	}
};
/**
* The 404 a loader or middleware throws when the thing it was asked for does
* not exist:
*
* ```ts
* const post = await getPost(params.slug);
* if (!post) throw notFound();
* ```
*
* Returns the error instead of throwing it so the throw stays visible to
* readers and to TypeScript's control-flow analysis (same shape as
* `redirect()`). The response renders the app's `notFound` page when one is
* configured and the route exports no `ErrorBoundary`.
*/
function notFound(message = "Not found") {
	return new PrachtHttpError(404, message);
}
//#endregion
export { PrachtHttpError, notFound };
