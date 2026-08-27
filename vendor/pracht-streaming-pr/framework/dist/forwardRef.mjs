import { options } from "preact";
//#region src/forwardRef.ts
let oldDiffHook = options.__b;
options.__b = (vnode) => {
	if (vnode.type && vnode.type.__f && vnode.ref) {
		vnode.props.ref = vnode.ref;
		vnode.ref = null;
	}
	if (oldDiffHook) oldDiffHook(vnode);
};
/**
* Pass ref down to a child. This is mainly used in libraries with HOCs that
* wrap components. Using `forwardRef` there is an easy way to get a reference
* of the wrapped component instead of one of the wrapper itself.
*/
function forwardRef(fn) {
	function Forwarded(props) {
		const clone = { ...props };
		delete clone.ref;
		return fn(clone, props.ref || null);
	}
	Forwarded.__f = true;
	Forwarded.displayName = "ForwardRef(" + (fn.displayName || fn.name) + ")";
	return Forwarded;
}
//#endregion
export { forwardRef };
