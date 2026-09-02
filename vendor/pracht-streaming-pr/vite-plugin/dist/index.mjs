import { c as createRouteLoaderHints, d as LEGACY_BARE_ROUTE_EXTENSIONS, f as extensionGlob, i as scanPagesDirectory, l as createRouteStaticPathsHints, m as withAdditionalExtensions, n as generatePagesManifestSource, o as createRouteHeadHints, p as normalizeAdditionalExtensions, s as createRouteHeadersHints, u as DEFAULT_ROUTE_EXTENSIONS } from "./pages-router-MA9rOl88.mjs";
import { createRequire, isBuiltin } from "node:module";
import { preactSsrPrecompile } from "@pracht/preact-ssr-precompile";
import preact from "@preact/preset-vite";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { loadEnv, parseAst } from "vite";
import { PRACHT_GRAPH_ONLY_ENV } from "@pracht/core/server";
import { DEV_ROUTE_DATA_STALE_EVENT } from "@pracht/core/client";
import { CAPABILITY_SETTLED_EVENT, CAPABILITY_TRANSPORT_HEADER, CONFIRMATION_HEADER } from "@pracht/capabilities";
import { extractCapabilityProjection, extractCapabilityRegistrations, extractDefineAppObjectBody, scanTopLevelProperties } from "@pracht/capabilities/static";
import { createNodeServerEntryModule } from "@pracht/adapter-node";
import { Readable } from "node:stream";
import { applyDefaultSecurityHeaders, resolveRegistryModule } from "@pracht/core";
//#region src/client-module-query.ts
const CLIENT_MODULE_QUERY = "pracht-client";
const PRACHT_CLIENT_MODULE_QUERY = `?${CLIENT_MODULE_QUERY}`;
function isPrachtClientModuleId(id) {
	const queryStart = id.indexOf("?");
	if (queryStart === -1) return false;
	return id.slice(queryStart + 1).split("&").includes(CLIENT_MODULE_QUERY);
}
function stripPrachtClientModuleQuery(id) {
	const queryStart = id.indexOf("?");
	if (queryStart === -1) return id;
	const path = id.slice(0, queryStart);
	const query = id.slice(queryStart + 1).split("&").filter((part) => part !== CLIENT_MODULE_QUERY);
	return query.length > 0 ? `${path}?${query.join("&")}` : path;
}
/** Extensions `@prefresh/vite` accepts: `/\.(c|m)?(t|j)sx?$/`, anchored at end. */
const PREFRESH_EXTENSION_RE = /\.((?:c|m)?[tj]sx?)$/i;
function isPrefreshCompatibleId(id) {
	return PREFRESH_EXTENSION_RE.test(id);
}
/**
* The id to hand `@prefresh/vite` for a pracht client module.
*
* Prefresh uses the id for exactly three things: its `/\.(c|m)?(t|j)sx?$/`
* filter, a `/\.tsx?$/` check that picks the TypeScript parser plugin, and the
* key it embeds in the `$RefreshReg$` it injects. A query-carrying id fails the
* first two, which is why route and shell modules got no Fast Refresh at all —
* but simply stripping the query fails the third: one file under `src/routes`
* can reach the browser as *two* module instances, once through the route glob
* as `…/x.tsx?pracht-client` and once as a plain import from a sibling route.
* Both would then register under the same key, and `@prefresh/core` treats a
* second `register()` for a known key with a different function object as a
* pending component replacement — which the next unrelated Fast Refresh
* flushes, tearing down and re-running the untouched copy's effects.
*
* A reserved, length-prefixed namespace keeps the real extension last, so the
* filter and parser check still pass, while giving each complete module id its
* own registration key. Keeping the authored id verbatim makes the mapping
* injective; keeping it behind a non-file prefix prevents a real sibling such
* as `x.pracht-client.tsx` from colliding with the synthetic key. The id is
* never resolved against the filesystem; the JSX dev transform has already
* stamped `_jsxFileName` from the real id by the time prefresh runs, so dev
* source locations and open-in-editor are unaffected.
*
* Compiled formats whose real extension prefresh rejects (`.md`, `.mdx`, and
* configured additional formats) instead keep that extension in the basename
* and receive a synthetic `.jsx`. Their companion Vite plugin has already
* turned the authored format into JavaScript by the time this id is used.
*/
function toPrachtClientPrefreshId(id) {
	const stripped = stripPrachtClientModuleQuery(id);
	const queryStart = stripped.indexOf("?");
	const path = queryStart === -1 ? stripped : stripped.slice(0, queryStart);
	const parserExtension = PREFRESH_EXTENSION_RE.exec(path)?.[1] ?? "jsx";
	return `pracht-client:${id.length}:${id}.${parserExtension}`;
}
function getRolldownLang(id) {
	const path = stripPrachtClientModuleQuery(id).split("?")[0];
	if (/\.(c|m)?tsx$/i.test(path)) return "tsx";
	if (/\.(c|m)?ts$/i.test(path)) return "ts";
	if (/\.(c|m)?jsx$/i.test(path)) return "jsx";
	if (/\.mdx?$/i.test(path)) return "jsx";
	if (/\.(c|m)?js$/i.test(path)) return "js";
	return "tsx";
}
//#endregion
//#region src/scope-analysis-types.ts
const JSX_COMPONENT_RE = /^[A-Z]/;
const SKIPPED_KEYS = new Set([
	"attributes",
	"decorators",
	"end",
	"exportKind",
	"importKind",
	"optional",
	"phase",
	"raw",
	"returnType",
	"start",
	"superTypeArguments",
	"type",
	"typeAnnotation",
	"typeArguments",
	"typeParameters",
	"value"
]);
//#endregion
//#region src/scope-analysis-helpers.ts
function getStatementDeclaration(statement) {
	if (statement.type === "ExportNamedDeclaration") return statement.declaration ?? null;
	if (statement.type === "ExportDefaultDeclaration" && (statement.declaration.type === "FunctionDeclaration" || statement.declaration.type === "ClassDeclaration")) return statement.declaration;
	if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration" || statement.type === "VariableDeclaration") return statement;
	return null;
}
function collectBindingNamesFromPattern(pattern) {
	if (!pattern) return [];
	switch (pattern.type) {
		case "Identifier": return [pattern.name];
		case "AssignmentPattern": return collectBindingNamesFromPattern(pattern.left);
		case "RestElement": return collectBindingNamesFromPattern(pattern.argument);
		case "ObjectPattern": return pattern.properties.flatMap((property) => {
			if (property.type === "Property") return collectBindingNamesFromPattern(property.value);
			return collectBindingNamesFromPattern(property.argument);
		});
		case "ArrayPattern": return pattern.elements.flatMap((element) => collectBindingNamesFromPattern(element));
		default: return [];
	}
}
function getIdentifierName(node) {
	if (!node) return null;
	if (node.type === "Identifier" || node.type === "JSXIdentifier") return node.name;
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	return null;
}
function isNode(value) {
	return !!value && typeof value === "object" && "type" in value;
}
function getTsRuntimeChildren(node) {
	switch (node.type) {
		case "TSAsExpression":
		case "TSInstantiationExpression":
		case "TSNonNullExpression":
		case "TSSatisfiesExpression":
		case "TSTypeAssertion": return [node.expression];
		default: return [];
	}
}
function collectFunctionScopedVarBindings(node) {
	const names = /* @__PURE__ */ new Set();
	collectFunctionScopedVarBindingsInto(node, names);
	return names;
}
function collectFunctionScopedVarBindingsInto(node, names) {
	if (!node) return;
	if (node.type.startsWith("TS")) {
		for (const child of getTsRuntimeChildren(node)) collectFunctionScopedVarBindingsInto(child, names);
		return;
	}
	switch (node.type) {
		case "ArrowFunctionExpression":
		case "FunctionDeclaration":
		case "FunctionExpression":
		case "ClassDeclaration":
		case "ClassExpression": return;
		case "VariableDeclaration":
			if (node.kind === "var") for (const declarator of node.declarations) for (const name of collectBindingNamesFromPattern(declarator.id)) names.add(name);
			return;
		default: for (const [key, value] of Object.entries(node)) {
			if (SKIPPED_KEYS.has(key)) continue;
			if (key === "id" || key === "implements" || key === "superTypeArguments") continue;
			collectFunctionScopedVarBindingsFromUnknown(value, names);
		}
	}
}
function collectFunctionScopedVarBindingsFromUnknown(value, names) {
	if (Array.isArray(value)) {
		for (const item of value) collectFunctionScopedVarBindingsFromUnknown(item, names);
		return;
	}
	if (!isNode(value)) return;
	collectFunctionScopedVarBindingsInto(value, names);
}
//#endregion
//#region src/client-module-transform-state.ts
function createStatementStates(program) {
	return program.body.map((node) => ({
		node,
		removed: false,
		removedDeclarators: /* @__PURE__ */ new Set(),
		removedSpecifiers: /* @__PURE__ */ new Set()
	}));
}
function getRemainingDeclaratorIndices(state) {
	const declaration = getStatementDeclaration(state.node);
	if (!declaration || declaration.type !== "VariableDeclaration") return [];
	return declaration.declarations.map((_item, index) => index).filter((index) => !state.removedDeclarators.has(index));
}
function getRemainingSpecifierIndices(state) {
	const statement = state.node;
	if (!("specifiers" in statement) || !Array.isArray(statement.specifiers)) return [];
	return statement.specifiers.map((_item, index) => index).filter((index) => !state.removedSpecifiers.has(index));
}
function collectBindingNamesFromDeclaration(declaration) {
	if (declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") return declaration.id ? [declaration.id.name] : [];
	if (declaration.type === "VariableDeclaration") return declaration.declarations.flatMap((declarator) => collectBindingNamesFromPattern(declarator.id));
	return [];
}
function normalizeRetainedStatements(states) {
	return states.map((state) => normalizeRetainedStatement(state)).filter((state) => state !== null);
}
function normalizeRetainedStatement(state) {
	if (state.removed) return null;
	const statement = state.node;
	if (statement.type === "ImportDeclaration" && state.removedSpecifiers.size > 0) return { node: {
		...statement,
		specifiers: getRemainingSpecifierIndices(state).map((index) => statement.specifiers[index])
	} };
	if (statement.type === "ExportNamedDeclaration" && !statement.declaration && state.removedSpecifiers.size > 0) return { node: {
		...statement,
		specifiers: getRemainingSpecifierIndices(state).map((index) => statement.specifiers[index])
	} };
	const declaration = getStatementDeclaration(statement);
	if (declaration?.type === "VariableDeclaration" && state.removedDeclarators.size > 0) {
		const retainedDeclaration = {
			...declaration,
			declarations: getRemainingDeclaratorIndices(state).map((index) => declaration.declarations[index])
		};
		if (statement.type === "ExportNamedDeclaration") return { node: {
			...statement,
			declaration: retainedDeclaration
		} };
		return { node: retainedDeclaration };
	}
	return { node: statement };
}
//#endregion
//#region src/client-module-transform-render.ts
function renderProgram(code, states) {
	let cursor = 0;
	let out = "";
	for (const state of states) {
		const statement = state.node;
		out += code.slice(cursor, statement.start);
		out += renderStatement(code, state);
		cursor = statement.end;
	}
	out += code.slice(cursor);
	return out;
}
function renderStatement(code, state) {
	if (state.removed) return "";
	const statement = state.node;
	const declaration = getStatementDeclaration(statement);
	if (statement.type === "ImportDeclaration" && state.removedSpecifiers.size > 0) return renderImportDeclaration(code, statement, state);
	if (statement.type === "ExportNamedDeclaration" && !statement.declaration && state.removedSpecifiers.size > 0) return renderExportSpecifiers(code, statement, state);
	if (declaration?.type === "VariableDeclaration" && state.removedDeclarators.size > 0) return renderVariableDeclaration(code, statement, declaration, state);
	return code.slice(statement.start, statement.end);
}
function renderImportDeclaration(code, statement, state) {
	const remaining = getRemainingSpecifierIndices(state).map((index) => statement.specifiers[index]);
	if (remaining.length === 0) return "";
	const defaultSpecifier = remaining.find((specifier) => specifier.type === "ImportDefaultSpecifier");
	const namespaceSpecifier = remaining.find((specifier) => specifier.type === "ImportNamespaceSpecifier");
	const namedSpecifiers = remaining.filter((specifier) => specifier.type === "ImportSpecifier");
	const clauseParts = [];
	if (defaultSpecifier) clauseParts.push(code.slice(defaultSpecifier.start, defaultSpecifier.end));
	if (namespaceSpecifier) clauseParts.push(code.slice(namespaceSpecifier.start, namespaceSpecifier.end));
	if (namedSpecifiers.length > 0) clauseParts.push(`{ ${namedSpecifiers.map((specifier) => code.slice(specifier.start, specifier.end)).join(", ")} }`);
	const importPrefix = ["import"];
	if (statement.importKind === "type") importPrefix.push("type");
	if (typeof statement.phase === "string" && statement.phase.length > 0) importPrefix.push(statement.phase);
	return `${importPrefix.join(" ")} ${clauseParts.join(", ")} from ${code.slice(statement.source.start, statement.end)}`;
}
function renderExportSpecifiers(code, statement, state) {
	const remaining = getRemainingSpecifierIndices(state).map((index) => statement.specifiers[index]);
	if (remaining.length === 0) return "";
	const exportPrefix = statement.exportKind === "type" ? "export type" : "export";
	const sourceSuffix = statement.source ? ` from ${code.slice(statement.source.start, statement.end)}` : ";";
	return `${exportPrefix} { ${remaining.map((specifier) => code.slice(specifier.start, specifier.end)).join(", ")} }${sourceSuffix}`;
}
function renderVariableDeclaration(code, statement, declaration, state) {
	const remaining = getRemainingDeclaratorIndices(state).map((index) => declaration.declarations[index]);
	if (remaining.length === 0) return "";
	return `${statement.type === "ExportNamedDeclaration" ? "export " : ""}${declaration.kind} ${remaining.map((item) => code.slice(item.start, item.end)).join(", ")};`;
}
//#endregion
//#region src/scope-analysis-declare.ts
function createScope(type, parent, node) {
	return {
		bindings: /* @__PURE__ */ new Map(),
		node,
		parent,
		type
	};
}
function declareBinding(scope, name, kind, node) {
	const binding = {
		kind,
		name,
		node,
		scope
	};
	scope.bindings.set(name, binding);
	return binding;
}
function declareProgramScopes(statements, programScope, scopesByNode) {
	for (const statement of statements) declareTopLevelStatement(statement.node, programScope);
	for (const statement of statements) declareNodeScopes(statement.node, programScope, scopesByNode);
}
function declareTopLevelStatement(statement, programScope) {
	if (statement.type === "ImportDeclaration") {
		if (statement.importKind === "type") return;
		for (const specifier of statement.specifiers) {
			if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
			const localName = getIdentifierName(specifier.local);
			if (localName) declareBinding(programScope, localName, "import", specifier);
		}
		return;
	}
	const declaration = getStatementDeclaration(statement);
	if (!declaration) return;
	declareDeclarationBindings(programScope, declaration);
}
function declareNodeScopes(node, currentScope, scopesByNode) {
	if (!node) return;
	if (node.type.startsWith("TS")) {
		for (const child of getTsRuntimeChildren(node)) declareNodeScopes(child, currentScope, scopesByNode);
		return;
	}
	switch (node.type) {
		case "ImportDeclaration": return;
		case "ArrowFunctionExpression":
		case "FunctionDeclaration":
		case "FunctionExpression": {
			const functionScope = createScope("function", currentScope, node);
			scopesByNode.set(node, functionScope);
			declareFunctionBindings(node, functionScope);
			for (const param of node.params) declareNodeScopes(param, functionScope, scopesByNode);
			declareNodeScopes(node.body, functionScope, scopesByNode);
			return;
		}
		case "BlockStatement": {
			const blockScope = createScope("block", currentScope, node);
			scopesByNode.set(node, blockScope);
			declareBlockBindings(node.body, blockScope);
			for (const statement of node.body) declareNodeScopes(statement, blockScope, scopesByNode);
			return;
		}
		case "CatchClause": {
			const catchScope = createScope("catch", currentScope, node);
			scopesByNode.set(node, catchScope);
			declareCatchBindings(node, catchScope);
			if (node.param) declareNodeScopes(node.param, catchScope, scopesByNode);
			declareNodeScopes(node.body, catchScope, scopesByNode);
			return;
		}
		case "ForStatement": {
			const init = node.init;
			if (init?.type === "VariableDeclaration" && init.kind !== "var") {
				const loopScope = createScope("for", currentScope, node);
				scopesByNode.set(node, loopScope);
				declareDeclarationBindings(loopScope, init);
				declareNodeScopes(init, loopScope, scopesByNode);
				declareNodeScopes(node.test, loopScope, scopesByNode);
				declareNodeScopes(node.update, loopScope, scopesByNode);
				declareNodeScopes(node.body, loopScope, scopesByNode);
				return;
			}
			declareNodeScopes(init, currentScope, scopesByNode);
			declareNodeScopes(node.test, currentScope, scopesByNode);
			declareNodeScopes(node.update, currentScope, scopesByNode);
			declareNodeScopes(node.body, currentScope, scopesByNode);
			return;
		}
		case "ForInStatement":
		case "ForOfStatement": {
			const left = node.left;
			if (left?.type === "VariableDeclaration" && left.kind !== "var") {
				const loopScope = createScope("for", currentScope, node);
				scopesByNode.set(node, loopScope);
				declareDeclarationBindings(loopScope, left);
				declareNodeScopes(left, loopScope, scopesByNode);
				declareNodeScopes(node.right, loopScope, scopesByNode);
				declareNodeScopes(node.body, loopScope, scopesByNode);
				return;
			}
			declareNodeScopes(left, currentScope, scopesByNode);
			declareNodeScopes(node.right, currentScope, scopesByNode);
			declareNodeScopes(node.body, currentScope, scopesByNode);
			return;
		}
		case "SwitchStatement": {
			declareNodeScopes(node.discriminant, currentScope, scopesByNode);
			const switchScope = createScope("switch", currentScope, node);
			scopesByNode.set(node, switchScope);
			declareSwitchBindings(node.cases, switchScope);
			for (const switchCase of node.cases) declareNodeScopes(switchCase, switchScope, scopesByNode);
			return;
		}
		case "ClassDeclaration":
		case "ClassExpression": {
			declareNodeScopes(node.superClass, currentScope, scopesByNode);
			const classScope = createScope("class", currentScope, node);
			scopesByNode.set(node, classScope);
			const name = getIdentifierName(node.id);
			if (name) declareBinding(classScope, name, "class", node);
			declareNodeScopes(node.body, classScope, scopesByNode);
			return;
		}
		case "ExportNamedDeclaration":
			if (node.declaration) declareNodeScopes(node.declaration, currentScope, scopesByNode);
			return;
		case "ExportDefaultDeclaration":
			if (node.declaration.type !== "Identifier") declareNodeScopes(node.declaration, currentScope, scopesByNode);
			return;
		default: for (const [key, value] of Object.entries(node)) {
			if (SKIPPED_KEYS.has(key)) continue;
			if (key === "id" || key === "implements" || key === "superTypeArguments") continue;
			declareUnknownValue(value, currentScope, scopesByNode);
		}
	}
}
function declareUnknownValue(value, currentScope, scopesByNode) {
	if (Array.isArray(value)) {
		for (const item of value) declareUnknownValue(item, currentScope, scopesByNode);
		return;
	}
	if (!isNode(value)) return;
	declareNodeScopes(value, currentScope, scopesByNode);
}
function declareFunctionBindings(node, scope) {
	const functionName = getIdentifierName(node.id);
	if (functionName) declareBinding(scope, functionName, "function", node);
	for (const param of node.params) for (const name of collectBindingNamesFromPattern(param)) declareBinding(scope, name, "param", param);
	for (const name of collectFunctionScopedVarBindings(node.body)) declareBinding(scope, name, "var", node.body);
}
function declareBlockBindings(statements, scope) {
	for (const statement of statements) {
		const declaration = getStatementDeclaration(statement);
		if (!declaration) continue;
		if (declaration.type === "VariableDeclaration" && declaration.kind === "var") continue;
		declareDeclarationBindings(scope, declaration);
	}
}
function declareCatchBindings(node, scope) {
	if (!node.param) return;
	for (const name of collectBindingNamesFromPattern(node.param)) declareBinding(scope, name, "catch", node.param);
}
function declareSwitchBindings(cases, scope) {
	const statements = [];
	for (const switchCase of cases) for (const statement of switchCase.consequent) statements.push(statement);
	declareBlockBindings(statements, scope);
}
function declareDeclarationBindings(scope, declaration) {
	if (declaration.type === "FunctionDeclaration") {
		const name = getIdentifierName(declaration.id);
		if (name) declareBinding(scope, name, "function", declaration);
		return;
	}
	if (declaration.type === "ClassDeclaration") {
		const name = getIdentifierName(declaration.id);
		if (name) declareBinding(scope, name, "class", declaration);
		return;
	}
	if (declaration.type !== "VariableDeclaration") return;
	for (const declarator of declaration.declarations) for (const name of collectBindingNamesFromPattern(declarator.id)) declareBinding(scope, name, declaration.kind, declarator);
}
//#endregion
//#region src/scope-analysis-references.ts
function collectStatementReferences(statement, currentScope, scopesByNode, result, excludedNames) {
	if (statement.type === "ImportDeclaration") return;
	if (statement.type === "ExportNamedDeclaration") {
		const declaration = statement.declaration;
		if (declaration) collectNodeReferences(declaration, currentScope, scopesByNode, result, excludedNames);
		return;
	}
	if (statement.type === "ExportDefaultDeclaration") {
		const declaration = statement.declaration;
		if (declaration.type !== "Identifier") collectNodeReferences(declaration, currentScope, scopesByNode, result, excludedNames);
		return;
	}
	collectNodeReferences(statement, currentScope, scopesByNode, result, excludedNames);
}
function collectNodeReferences(node, currentScope, scopesByNode, result, excludedNames) {
	if (!node) return;
	if (node.type.startsWith("TS")) {
		for (const child of getTsRuntimeChildren(node)) collectNodeReferences(child, currentScope, scopesByNode, result, excludedNames);
		return;
	}
	switch (node.type) {
		case "Identifier":
			recordReference(node.name, node, currentScope, result, excludedNames);
			return;
		case "JSXIdentifier":
			if (JSX_COMPONENT_RE.test(node.name)) recordReference(node.name, node, currentScope, result, excludedNames);
			return;
		case "ArrowFunctionExpression":
		case "FunctionDeclaration":
		case "FunctionExpression": {
			const functionScope = scopesByNode.get(node) ?? currentScope;
			for (const param of node.params) collectPatternReferences(param, functionScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.body, functionScope, scopesByNode, result, excludedNames);
			return;
		}
		case "BlockStatement": {
			const blockScope = scopesByNode.get(node) ?? currentScope;
			for (const statement of node.body) collectStatementReferences(statement, blockScope, scopesByNode, result, excludedNames);
			return;
		}
		case "CatchClause": {
			const catchScope = scopesByNode.get(node) ?? currentScope;
			if (node.param) collectPatternReferences(node.param, catchScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.body, catchScope, scopesByNode, result, excludedNames);
			return;
		}
		case "ForStatement": {
			const loopScope = scopesByNode.get(node) ?? currentScope;
			collectNodeReferences(node.init, loopScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.test, loopScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.update, loopScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.body, loopScope, scopesByNode, result, excludedNames);
			return;
		}
		case "ForInStatement":
		case "ForOfStatement": {
			const loopScope = scopesByNode.get(node) ?? currentScope;
			collectNodeReferences(node.left, loopScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.right, loopScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.body, loopScope, scopesByNode, result, excludedNames);
			return;
		}
		case "SwitchStatement": {
			collectNodeReferences(node.discriminant, currentScope, scopesByNode, result, excludedNames);
			const switchScope = scopesByNode.get(node) ?? currentScope;
			for (const switchCase of node.cases) {
				collectNodeReferences(switchCase.test, switchScope, scopesByNode, result, excludedNames);
				for (const statement of switchCase.consequent) collectStatementReferences(statement, switchScope, scopesByNode, result, excludedNames);
			}
			return;
		}
		case "ClassDeclaration":
		case "ClassExpression": {
			collectNodeReferences(node.superClass, currentScope, scopesByNode, result, excludedNames);
			const classScope = scopesByNode.get(node) ?? currentScope;
			collectNodeReferences(node.body, classScope, scopesByNode, result, excludedNames);
			return;
		}
		case "VariableDeclaration":
			for (const declarator of node.declarations) collectVariableDeclaratorReferences(declarator, currentScope, scopesByNode, result, excludedNames);
			return;
		case "MemberExpression":
			collectNodeReferences(node.object, currentScope, scopesByNode, result, excludedNames);
			if (node.computed) collectNodeReferences(node.property, currentScope, scopesByNode, result, excludedNames);
			return;
		case "MetaProperty": return;
		case "LabeledStatement":
			collectNodeReferences(node.body, currentScope, scopesByNode, result, excludedNames);
			return;
		case "BreakStatement":
		case "ContinueStatement": return;
		case "Property":
			if (node.computed) collectNodeReferences(node.key, currentScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.value, currentScope, scopesByNode, result, excludedNames);
			return;
		case "ObjectPattern":
		case "ArrayPattern":
		case "AssignmentPattern":
		case "RestElement":
			collectPatternReferences(node, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXElement":
			collectNodeReferences(node.openingElement, currentScope, scopesByNode, result, excludedNames);
			for (const child of node.children) collectNodeReferences(child, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXFragment":
			for (const child of node.children) collectNodeReferences(child, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXOpeningElement":
			collectNodeReferences(node.name, currentScope, scopesByNode, result, excludedNames);
			for (const attribute of node.attributes) collectNodeReferences(attribute, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXClosingElement":
			collectNodeReferences(node.name, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXAttribute":
			collectNodeReferences(node.value, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXExpressionContainer":
			collectNodeReferences(node.expression, currentScope, scopesByNode, result, excludedNames);
			return;
		case "JSXMemberExpression":
			collectNodeReferences(node.object, currentScope, scopesByNode, result, excludedNames);
			return;
		case "MethodDefinition":
		case "PropertyDefinition":
			if (node.computed) collectNodeReferences(node.key, currentScope, scopesByNode, result, excludedNames);
			collectNodeReferences(node.value, currentScope, scopesByNode, result, excludedNames);
			return;
		case "ImportDeclaration": return;
		case "ExportNamedDeclaration":
			if (node.declaration) collectNodeReferences(node.declaration, currentScope, scopesByNode, result, excludedNames);
			return;
		case "ExportDefaultDeclaration":
			if (node.declaration.type !== "Identifier") collectNodeReferences(node.declaration, currentScope, scopesByNode, result, excludedNames);
			return;
		default: for (const [key, value] of Object.entries(node)) {
			if (SKIPPED_KEYS.has(key)) continue;
			if (key === "id" || key === "implements" || key === "superTypeArguments") continue;
			collectUnknownValueReferences(value, currentScope, scopesByNode, result, excludedNames);
		}
	}
}
function collectUnknownValueReferences(value, currentScope, scopesByNode, result, excludedNames) {
	if (Array.isArray(value)) {
		for (const item of value) collectUnknownValueReferences(item, currentScope, scopesByNode, result, excludedNames);
		return;
	}
	if (!isNode(value)) return;
	collectNodeReferences(value, currentScope, scopesByNode, result, excludedNames);
}
function collectVariableDeclaratorReferences(declarator, currentScope, scopesByNode, result, excludedNames) {
	collectPatternReferences(declarator.id, currentScope, scopesByNode, result, excludedNames);
	collectNodeReferences(declarator.init, currentScope, scopesByNode, result, excludedNames);
}
function collectPatternReferences(node, currentScope, scopesByNode, result, excludedNames) {
	if (!node) return;
	if (node.type.startsWith("TS")) {
		for (const child of getTsRuntimeChildren(node)) collectNodeReferences(child, currentScope, scopesByNode, result, excludedNames);
		return;
	}
	switch (node.type) {
		case "AssignmentPattern":
			collectNodeReferences(node.right, currentScope, scopesByNode, result, excludedNames);
			collectPatternReferences(node.left, currentScope, scopesByNode, result, excludedNames);
			return;
		case "ObjectPattern":
			for (const property of node.properties) {
				if (property.type === "Property") {
					if (property.computed) collectNodeReferences(property.key, currentScope, scopesByNode, result, excludedNames);
					collectPatternReferences(property.value, currentScope, scopesByNode, result, excludedNames);
					continue;
				}
				collectPatternReferences(property.argument, currentScope, scopesByNode, result, excludedNames);
			}
			return;
		case "ArrayPattern":
			for (const element of node.elements) collectPatternReferences(element, currentScope, scopesByNode, result, excludedNames);
			return;
		case "RestElement":
			collectPatternReferences(node.argument, currentScope, scopesByNode, result, excludedNames);
			return;
		default: return;
	}
}
function recordReference(name, node, currentScope, result, excludedNames) {
	const resolvedBinding = resolveBinding(name, currentScope);
	result.references.push({
		name,
		node,
		resolvedBinding
	});
	if (!resolvedBinding) return;
	if (resolvedBinding.scope.type !== "program") return;
	if (excludedNames.has(name)) return;
	result.referencedTopLevelNames.add(name);
}
function resolveBinding(name, currentScope) {
	let scope = currentScope;
	while (scope) {
		const binding = scope.bindings.get(name);
		if (binding) return binding;
		scope = scope.parent;
	}
	return null;
}
//#endregion
//#region src/client-module-scope-analysis.ts
function analyzeRetainedStatements(statements, options = {}) {
	const programScope = createScope("program", null, null);
	for (const name of options.knownTopLevelNames ?? []) declareBinding(programScope, name, "placeholder", null);
	const scopesByNode = /* @__PURE__ */ new WeakMap();
	declareProgramScopes(statements, programScope, scopesByNode);
	const result = {
		programScope,
		referencedTopLevelNames: /* @__PURE__ */ new Set(),
		references: []
	};
	const excludedNames = new Set(options.excludedNames);
	for (const statement of statements) collectStatementReferences(statement.node, programScope, scopesByNode, result, excludedNames);
	return result;
}
//#endregion
//#region src/client-module-transform.ts
const SERVER_ONLY_EXPORTS = new Set([
	"loader",
	"head",
	"headers",
	"getStaticPaths",
	"markdown"
]);
function stripServerOnlyExportsForClient(code, id = "pracht-client-route.tsx") {
	const states = createStatementStates(parseAst(code, { lang: getRolldownLang(id) }));
	const initialBindingNames = collectCurrentTopLevelBindingNames(states);
	const { changed, candidates } = removeServerOnlyExports(states, initialBindingNames);
	if (!changed) return code;
	pruneDeadBindings(states, initialBindingNames, candidates);
	return renderProgram(code, states);
}
function removeServerOnlyExports(states, initialBindingNames) {
	let changed = false;
	const candidates = /* @__PURE__ */ new Set();
	for (const state of states) {
		const statement = state.node;
		if (statement.type !== "ExportNamedDeclaration" || statement.exportKind === "type") continue;
		const declaration = statement.declaration;
		if (declaration?.type === "FunctionDeclaration") {
			const name = declaration.id?.name;
			if (!name || !SERVER_ONLY_EXPORTS.has(name)) continue;
			changed = true;
			state.removed = true;
			enqueueDependencies(candidates, collectTopLevelReferences(declaration, initialBindingNames, new Set([name])));
			continue;
		}
		if (declaration?.type === "VariableDeclaration") {
			const removable = getRemainingDeclaratorIndices(state).filter((index) => collectBindingNamesFromPattern(declaration.declarations[index].id).some((name) => SERVER_ONLY_EXPORTS.has(name)));
			if (removable.length === 0) continue;
			changed = true;
			for (const index of removable) {
				const declarator = declaration.declarations[index];
				const declaredNames = new Set(collectBindingNamesFromPattern(declarator.id));
				enqueueDependencies(candidates, collectVariableDeclaratorDependencies(declarator, declaration.kind, initialBindingNames, declaredNames));
				state.removedDeclarators.add(index);
			}
			if (getRemainingDeclaratorIndices(state).length === 0) state.removed = true;
			continue;
		}
		const removableSpecifiers = getRemainingSpecifierIndices(state).filter((index) => {
			const specifier = statement.specifiers[index];
			if (specifier.type !== "ExportSpecifier" || specifier.exportKind === "type") return false;
			const localName = getIdentifierName(specifier.local);
			const exportedName = getIdentifierName(specifier.exported);
			return SERVER_ONLY_EXPORTS.has(localName ?? "") || SERVER_ONLY_EXPORTS.has(exportedName ?? "");
		});
		if (removableSpecifiers.length === 0) continue;
		changed = true;
		for (const index of removableSpecifiers) {
			const specifier = statement.specifiers[index];
			if (!statement.source) {
				const localName = getIdentifierName(specifier.local);
				if (localName) candidates.add(localName);
			}
			state.removedSpecifiers.add(index);
		}
		if (getRemainingSpecifierIndices(state).length === 0) state.removed = true;
	}
	return {
		changed,
		candidates
	};
}
function pruneDeadBindings(states, initialBindingNames, candidates) {
	let changed = true;
	while (changed) {
		changed = false;
		const bindings = collectTopLevelBindings(states, initialBindingNames);
		const exportedNames = collectExportedBindingNames(states);
		const referencedNames = collectProgramReferences(states);
		const pendingNames = Array.from(candidates);
		for (const name of pendingNames) {
			const binding = bindings.get(name);
			if (!binding) continue;
			if (exportedNames.has(name) || referencedNames.has(name)) continue;
			removeBinding(states, binding);
			enqueueDependencies(candidates, binding.dependencies);
			changed = true;
		}
	}
}
function collectTopLevelBindings(states, dependencyBindingNames) {
	const bindings = /* @__PURE__ */ new Map();
	for (const [statementIndex, state] of states.entries()) {
		if (state.removed) continue;
		const statement = state.node;
		if (statement.type === "ImportDeclaration") {
			if (statement.importKind === "type") continue;
			for (const index of getRemainingSpecifierIndices(state)) {
				const specifier = statement.specifiers[index];
				if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
				const local = specifier.local;
				const name = getIdentifierName(local);
				if (!name) continue;
				const info = {
					dependencies: /* @__PURE__ */ new Set(),
					kind: "import",
					names: new Set([name]),
					node: specifier,
					specifierIndex: index,
					statementIndex
				};
				bindings.set(name, info);
			}
			continue;
		}
		const declaration = getStatementDeclaration(statement);
		if (!declaration) continue;
		if (declaration.type === "FunctionDeclaration") {
			const name = getIdentifierName(declaration.id);
			if (!name) continue;
			const info = {
				dependencies: collectTopLevelReferences(declaration, dependencyBindingNames, new Set([name])),
				kind: "function",
				names: new Set([name]),
				node: declaration,
				statementIndex
			};
			bindings.set(name, info);
			continue;
		}
		if (declaration.type === "ClassDeclaration") {
			const name = getIdentifierName(declaration.id);
			if (!name) continue;
			const info = {
				dependencies: collectTopLevelReferences(declaration, dependencyBindingNames, new Set([name])),
				kind: "class",
				names: new Set([name]),
				node: declaration,
				statementIndex
			};
			bindings.set(name, info);
			continue;
		}
		if (declaration.type !== "VariableDeclaration") continue;
		for (const index of getRemainingDeclaratorIndices(state)) {
			const declarator = declaration.declarations[index];
			const names = new Set(collectBindingNamesFromPattern(declarator.id));
			if (names.size === 0) continue;
			const info = {
				declaratorIndex: index,
				dependencies: collectVariableDeclaratorDependencies(declarator, declaration.kind, dependencyBindingNames, names),
				kind: "variable",
				names,
				node: declarator,
				statementIndex
			};
			for (const name of names) bindings.set(name, info);
		}
	}
	return bindings;
}
function collectCurrentTopLevelBindingNames(states) {
	const names = /* @__PURE__ */ new Set();
	for (const state of states) {
		if (state.removed) continue;
		const statement = state.node;
		if (statement.type === "ImportDeclaration") {
			if (statement.importKind === "type") continue;
			for (const index of getRemainingSpecifierIndices(state)) {
				const specifier = statement.specifiers[index];
				if (specifier.type === "ImportSpecifier" && specifier.importKind === "type") continue;
				const localName = getIdentifierName(specifier.local);
				if (localName) names.add(localName);
			}
			continue;
		}
		const declaration = getStatementDeclaration(statement);
		if (!declaration) continue;
		if (declaration.type === "VariableDeclaration") {
			for (const index of getRemainingDeclaratorIndices(state)) {
				const declarator = declaration.declarations[index];
				for (const name of collectBindingNamesFromPattern(declarator.id)) names.add(name);
			}
			continue;
		}
		for (const name of collectBindingNamesFromDeclaration(declaration)) names.add(name);
	}
	return names;
}
function collectExportedBindingNames(states) {
	const names = /* @__PURE__ */ new Set();
	for (const state of states) {
		if (state.removed) continue;
		const statement = state.node;
		if (statement.type === "ExportNamedDeclaration") {
			const declaration = statement.declaration;
			if (declaration) if (declaration.type === "VariableDeclaration") for (const index of getRemainingDeclaratorIndices(state)) {
				const declarator = declaration.declarations[index];
				for (const name of collectBindingNamesFromPattern(declarator.id)) names.add(name);
			}
			else for (const name of collectBindingNamesFromDeclaration(declaration)) names.add(name);
			for (const index of getRemainingSpecifierIndices(state)) {
				const specifier = statement.specifiers[index];
				if (specifier.type !== "ExportSpecifier" || specifier.exportKind === "type") continue;
				const localName = getIdentifierName(specifier.local);
				if (localName) names.add(localName);
			}
		}
		if (statement.type !== "ExportDefaultDeclaration") continue;
		const declaration = statement.declaration;
		if (declaration.type === "Identifier") {
			names.add(declaration.name);
			continue;
		}
		if ((declaration.type === "FunctionDeclaration" || declaration.type === "ClassDeclaration") && declaration.id) names.add(declaration.id.name);
	}
	return names;
}
function collectProgramReferences(states) {
	return analyzeRetainedStatements(normalizeRetainedStatements(states)).referencedTopLevelNames;
}
function removeBinding(states, binding) {
	const state = states[binding.statementIndex];
	if (binding.kind === "import" && binding.specifierIndex !== void 0) {
		state.removedSpecifiers.add(binding.specifierIndex);
		if (getRemainingSpecifierIndices(state).length === 0) state.removed = true;
		return;
	}
	if (binding.kind === "variable" && binding.declaratorIndex !== void 0) {
		state.removedDeclarators.add(binding.declaratorIndex);
		if (getRemainingDeclaratorIndices(state).length === 0) state.removed = true;
		return;
	}
	state.removed = true;
}
function collectVariableDeclaratorDependencies(declarator, declarationKind, topLevelBindingNames, excludedNames) {
	return collectTopLevelReferences({
		declarations: [declarator],
		end: declarator.end,
		kind: declarationKind,
		start: declarator.start,
		type: "VariableDeclaration"
	}, topLevelBindingNames, excludedNames);
}
function collectTopLevelReferences(node, topLevelBindingNames, excludedNames) {
	return analyzeRetainedStatements([{ node }], {
		excludedNames,
		knownTopLevelNames: topLevelBindingNames
	}).referencedTopLevelNames;
}
function enqueueDependencies(target, dependencies) {
	for (const name of dependencies) target.add(name);
}
//#endregion
//#region src/chunk-groups.ts
/**
* Pracht's client chunking policy, expressed as something an app can build on.
*
* The framework has exactly one opinion here: Preact belongs in its own chunk,
* shared by every route and cached across deploys that only change app code.
* Everything else about chunking is the app's call — merging the long tail of
* small initial chunks, splitting a heavy dependency out of a route, grouping
* by feature.
*
* Those two have to coexist, and under Rolldown that is not automatic:
* `output.codeSplitting` makes `manualChunks` and `advancedChunks` ignored
* outright, so a plugin that hard-codes one form silently deletes whichever
* form the app used. Pracht therefore looks at what the app configured and
* contributes its group in the same form, as one entry appended to the app's
* list rather than as a replacement for it.
*
* Precedence follows Rolldown's own rule — higher `priority` first, then
* declaration order. The app's groups are declared first, so an app group that
* would also capture Preact wins at equal priority, and pracht's group only
* takes what nothing else claimed. To keep the framework chunk intact while
* merging everything around it, give the app group a `test` that excludes
* Preact, or raise pracht's group by placing {@link frameworkChunkGroups}
* explicitly and setting `vendorChunk: false`.
*/
/**
* Modules that make up the framework runtime's vendor chunk.
*
* `[\\/]` rather than `/` so the group matches on Windows, and no trailing
* boundary so the Preact family — `preact/hooks`, `preact-suspense`,
* `preact-render-to-string` — lands in one chunk with Preact itself.
*/
const FRAMEWORK_VENDOR_TEST = /node_modules[\\/]preact/;
/** Name of the chunk pracht groups the Preact runtime into. */
const FRAMEWORK_VENDOR_CHUNK = "vendor";
/**
* Pracht's chunk groups, as a fresh array an app can place in its own
* `output.codeSplitting.groups`.
*
* Use this together with `pracht({ vendorChunk: false })` when the framework
* group has to sit somewhere other than last — pracht then contributes no
* chunking config of its own and the app's list is the whole policy.
*/
function frameworkChunkGroups() {
	return [{
		name: FRAMEWORK_VENDOR_CHUNK,
		test: FRAMEWORK_VENDOR_TEST
	}];
}
/** Whether a module id belongs in the framework vendor chunk. */
function isFrameworkVendorModule(id) {
	return FRAMEWORK_VENDOR_TEST.test(id);
}
/**
* Build the chunking config pracht contributes, given what the app configured.
*
* Returns a partial `output` because Vite merges a plugin's `config()` result
* over the user config and concatenates arrays: returning only pracht's group
* is what appends it to the app's list instead of replacing it.
*/
function frameworkChunkConfig(output) {
	if (Array.isArray(output)) return { warning: "build.rollupOptions.output is an array, so pracht did not add its Preact vendor chunk group. Add frameworkChunkGroups() from @pracht/vite-plugin to each output's codeSplitting.groups to keep the framework chunk." };
	const options = output ?? {};
	if (options.codeSplitting === false) return {};
	const groups = frameworkChunkGroups();
	if (options.codeSplitting === void 0) {
		if (isRecord(options.advancedChunks)) return { output: { advancedChunks: { groups } } };
		if (typeof options.manualChunks === "function") {
			const appManualChunks = options.manualChunks;
			return { output: { manualChunks(id, meta) {
				if (isFrameworkVendorModule(id)) return FRAMEWORK_VENDOR_CHUNK;
				return appManualChunks(id, meta);
			} } };
		}
	}
	return { output: { codeSplitting: { groups } } };
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
//#endregion
//#region src/env-safety.ts
/**
* Env vars Vite defines on `import.meta.env` in every bundle, plus NODE_ENV
* which Vite's define pass statically replaces at build time (so it can never
* leak and is referenced by countless dependencies).
*/
const VITE_BUILTIN_ENV_VARS = new Set([
	"MODE",
	"DEV",
	"PROD",
	"SSR",
	"BASE_URL",
	"NODE_ENV"
]);
/** Prefix that marks an env var as intentionally public. */
const PUBLIC_ENV_PREFIX = "PRACHT_PUBLIC_";
/** Server-only core entry that must never resolve into client bundles. */
const SERVER_ENV_MODULE_ID = "@pracht/core/env/server";
const ENV_REFERENCE_RE = /\b(process\.env|import\.meta\.env)(?:\??\.([A-Za-z_$][A-Za-z0-9_$]*)|(?:\?\.)?\[\s*(["'])([A-Za-z_$][A-Za-z0-9_$]*)\3\s*\])/g;
const WHOLE_ENV_READ_RE = /\bimport\.meta\.env\b(?!\s*\??\.\s*[A-Za-z_$])/g;
/**
* Scans JavaScript source for references to environment variables that are
* neither public-prefixed, Vite built-ins, nor explicitly allowed, plus reads
* that pull in the whole `import.meta.env` object.
*/
function scanCodeForEnvLeaks(code, allow = /* @__PURE__ */ new Set()) {
	const codePositions = getCodePositionMask(code);
	const matches = [];
	for (const match of code.matchAll(ENV_REFERENCE_RE)) {
		const index = match.index ?? -1;
		if (!codePositions[index]) continue;
		const accessor = match[1];
		const name = match[2] ?? match[4];
		if (!name) continue;
		if (name.startsWith("PRACHT_PUBLIC_")) continue;
		if (VITE_BUILTIN_ENV_VARS.has(name)) continue;
		if (allow.has(name)) continue;
		matches.push({
			index,
			reference: {
				accessor,
				name
			}
		});
	}
	if (!allow.has("*")) for (const match of code.matchAll(WHOLE_ENV_READ_RE)) {
		const index = match.index ?? -1;
		if (!codePositions[index]) continue;
		matches.push({
			index,
			reference: {
				accessor: "import.meta.env",
				name: "*"
			}
		});
	}
	const findings = [];
	const seen = /* @__PURE__ */ new Set();
	for (const { reference } of matches.sort((a, b) => a.index - b.index)) {
		const key = `${reference.accessor}.${reference.name}`;
		if (seen.has(key)) continue;
		seen.add(key);
		findings.push(reference);
	}
	return findings;
}
function getCodePositionMask(code) {
	const mask = new Uint8Array(code.length);
	const templateExpressionDepths = [];
	let mode = "code";
	let regexCharClass = false;
	let i = 0;
	while (i < code.length) {
		const char = code[i];
		const next = code[i + 1];
		if (mode === "line-comment") {
			if (char === "\n" || char === "\r") {
				mode = "code";
				mask[i] = 1;
			}
			i++;
			continue;
		}
		if (mode === "block-comment") {
			if (char === "*" && next === "/") {
				mode = "code";
				i += 2;
			} else i++;
			continue;
		}
		if (mode === "single" || mode === "double") {
			const quote = mode === "single" ? "'" : "\"";
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === quote || char === "\n" || char === "\r") mode = "code";
			i++;
			continue;
		}
		if (mode === "regex") {
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === "[") {
				regexCharClass = true;
				i++;
				continue;
			}
			if (char === "]") {
				regexCharClass = false;
				i++;
				continue;
			}
			if (char === "/" && !regexCharClass) {
				regexCharClass = false;
				i++;
				while (i < code.length && isIdentifierChar(code[i])) i++;
				mode = "code";
				continue;
			}
			if (char === "\n" || char === "\r") {
				regexCharClass = false;
				mode = "code";
			}
			i++;
			continue;
		}
		if (mode === "template") {
			if (char === "\\") {
				i += 2;
				continue;
			}
			if (char === "`") {
				mode = "code";
				i++;
				continue;
			}
			if (char === "$" && next === "{") {
				mask[i] = 1;
				mask[i + 1] = 1;
				templateExpressionDepths.push(1);
				mode = "code";
				i += 2;
				continue;
			}
			i++;
			continue;
		}
		mask[i] = 1;
		if (char === "/" && next === "/") {
			mask[i + 1] = 1;
			mode = "line-comment";
			i += 2;
			continue;
		}
		if (char === "/" && next === "*") {
			mask[i + 1] = 1;
			mode = "block-comment";
			i += 2;
			continue;
		}
		if (char === "/" && isRegexLiteralStart(code, i)) {
			mode = "regex";
			regexCharClass = false;
			i++;
			continue;
		}
		if (char === "'") {
			mode = "single";
			i++;
			continue;
		}
		if (char === "\"") {
			mode = "double";
			i++;
			continue;
		}
		if (char === "`") {
			mode = "template";
			i++;
			continue;
		}
		if (templateExpressionDepths.length > 0) {
			const top = templateExpressionDepths.length - 1;
			if (char === "{") templateExpressionDepths[top]++;
			else if (char === "}") {
				templateExpressionDepths[top]--;
				if (templateExpressionDepths[top] === 0) {
					templateExpressionDepths.pop();
					mode = "template";
				}
			}
		}
		i++;
	}
	return mask;
}
function isRegexLiteralStart(code, slashIndex) {
	let i = slashIndex - 1;
	while (i >= 0 && /\s/.test(code[i])) i--;
	if (i < 0) return true;
	const previous = code[i];
	if (previous === ">" && code[i - 1] === "=") return true;
	if ("([{=,:;!?&|^~<>*%+-".includes(previous)) return true;
	if (isIdentifierChar(previous)) {
		let start = i;
		while (start >= 0 && isIdentifierChar(code[start])) start--;
		const word = code.slice(start + 1, i + 1);
		return new Set([
			"await",
			"case",
			"delete",
			"do",
			"else",
			"in",
			"instanceof",
			"new",
			"of",
			"return",
			"throw",
			"typeof",
			"void",
			"yield"
		]).has(word);
	}
	return false;
}
function isIdentifierChar(char) {
	return !!char && /[A-Za-z0-9_$]/.test(char);
}
function formatEnvLeakError(problems) {
	const lines = problems.map((problem) => {
		const source = problem.sources.length > 0 ? ` (likely from ${problem.sources.map((file) => JSON.stringify(file)).join(", ")})` : "";
		return `  - ${problem.name === "*" ? "import.meta.env read as a whole object" : `${problem.accessor}.${problem.name}`} in chunk "${problem.chunk}"${source}`;
	});
	const wholeEnvGuidance = problems.some((problem) => problem.name === "*") ? [
		"",
		"A whole-object `import.meta.env` read (bare reference, destructuring, spread, or bracket access)",
		"is replaced at build time by an object literal containing every exposed variable — including the",
		"`VITE_` values Pracht does not treat as public. Read one key at a time (`import.meta.env.KEY`)."
	] : [];
	return [
		"[pracht] Environment variable leak detected in the client bundle:",
		...lines,
		...wholeEnvGuidance,
		"",
		`Only PRACHT_PUBLIC_-prefixed variables may be referenced in client code (prefer publicEnv from "@pracht/core" for typed public values).`,
		`Move server-only reads into loaders/API routes and access them via serverEnv from "@pracht/core/env/server",`,
		"or allowlist intentionally-safe names with pracht({ envSafety: { allow: [...] } })."
	].join("\n");
}
function stripIdQuery(id) {
	const queryStart = id.indexOf("?");
	return queryStart === -1 ? id : id.slice(0, queryStart);
}
/**
* Build-time leak detection: scans rendered client chunks for references to
* non-public env vars and fails the build with the variable, chunk, and the
* likely source module.
*/
function createEnvSafetyPlugin(envSafety) {
	const allow = new Set(envSafety === false ? [] : envSafety.allow ?? []);
	const moduleEnvReferences = /* @__PURE__ */ new Map();
	let isSsrBuild = false;
	return {
		name: "pracht:env-safety",
		apply: "build",
		enforce: "post",
		configResolved(config) {
			isSsrBuild = !!config.build.ssr;
		},
		transform(code, id, transformOptions) {
			if (envSafety === false) return null;
			if (transformOptions?.ssr) return null;
			const moduleId = stripIdQuery(id);
			if (moduleId.includes("node_modules")) return null;
			const findings = scanCodeForEnvLeaks(code, allow);
			if (findings.length > 0) moduleEnvReferences.set(moduleId, findings);
			return null;
		},
		generateBundle(_options, bundle) {
			if (envSafety === false) return;
			const consumer = this.environment?.config?.consumer;
			if (!(consumer ? consumer === "client" : !isSsrBuild)) return;
			const problems = [];
			const seen = /* @__PURE__ */ new Set();
			const addProblem = (problem) => {
				const key = `${problem.chunk}:${problem.accessor}.${problem.name}`;
				if (seen.has(key)) return;
				seen.add(key);
				problems.push(problem);
			};
			for (const [fileName, output] of Object.entries(bundle)) {
				if (output.type !== "chunk") continue;
				const moduleIds = (output.moduleIds ?? Object.keys(output.modules ?? {})).map(stripIdQuery);
				for (const moduleId of moduleIds) {
					const references = moduleEnvReferences.get(moduleId);
					if (!references) continue;
					for (const reference of references) addProblem({
						...reference,
						chunk: fileName,
						sources: [moduleId]
					});
				}
				for (const finding of scanCodeForEnvLeaks(output.code, allow)) {
					const sources = moduleIds.filter((moduleId) => moduleEnvReferences.get(moduleId)?.some((reference) => reference.name === finding.name));
					addProblem({
						...finding,
						chunk: fileName,
						sources
					});
				}
			}
			if (problems.length > 0) this.error(formatEnvLeakError(problems));
			this.emitFile({
				fileName: "_pracht/env-safety.json",
				source: JSON.stringify({
					findings: problems,
					version: 1
				}, null, 2),
				type: "asset"
			});
		}
	};
}
//#endregion
//#region src/client-module-prefresh.ts
/**
* Give route and shell modules Preact Fast Refresh.
*
* `@prefresh/vite` gates its transform on `/\.(c|m)?(t|j)sx?$/`, a pattern
* anchored at the end of the id — so an id carrying a query never matches.
* Pracht loads route and shell modules in the browser through
* `import.meta.glob(..., { query: "?pracht-client" })` so its post transform
* can strip server-only exports, which means the module the browser actually
* runs is `/src/routes/home.tsx?pracht-client`. Prefresh skipped it, no
* `import.meta.hot.accept` was injected, and with no self-accepting boundary
* the update propagated to the non-accepting virtual client entry: every edit
* to a route or a shell became a full page reload with client state loss.
* Components outside those directories were unaffected, which is why this hid
* for so long — Fast Refresh worked everywhere except the files a route-based
* framework is mostly made of.
*
* Running after `pracht:client-module-transform` (both are `post`; array order
* decides) is deliberate: prefresh sees the stripped module, whose exports are
* only components, rather than the authored one where a co-located `loader`
* would stop it self-accepting anyway.
*
* The id prefresh is handed is synthetic — see `toPrachtClientPrefreshId`. It
* must satisfy prefresh's extension filter *and* stay distinct from the id of
* the authored file, because the same file can be in the client graph twice and
* the id doubles as prefresh's component registration key.
*/
function createClientModulePrefreshPlugin(preactPlugins, config = {}) {
	const transform = resolvePrefreshTransform(preactPlugins);
	if (!transform) return null;
	return {
		name: "pracht:client-module-prefresh",
		enforce: "post",
		apply: "serve",
		async transform(code, id, transformOptions) {
			if (transformOptions?.ssr) return null;
			const carriesClientQuery = isPrachtClientModuleId(id);
			const isBareCompiledFormat = !carriesClientQuery && !isPrefreshCompatibleId(id) && config.isRouteOrShellModule?.(id) === true;
			if (!carriesClientQuery && !isBareCompiledFormat) return null;
			return await transform.call(this, code, toPrachtClientPrefreshId(id), transformOptions);
		}
	};
}
/**
* `@preact/preset-vite` returns a plugin array whose shape is its own business;
* find prefresh by name rather than by position, and treat its absence as "no
* Fast Refresh configured" rather than an error.
*/
function resolvePrefreshTransform(preactPlugins) {
	for (const plugin of flattenPlugins(preactPlugins)) {
		if (plugin.name !== "prefresh") continue;
		const transform = plugin.transform;
		if (typeof transform === "function") return transform;
		if (transform && typeof transform === "object" && "handler" in transform) return transform.handler;
	}
	return null;
}
function flattenPlugins(plugins) {
	const flat = [];
	const visit = (option) => {
		if (!option || typeof option.then === "function") return;
		if (Array.isArray(option)) {
			for (const nested of option) visit(nested);
			return;
		}
		if (typeof option === "object" && "name" in option) flat.push(option);
	};
	for (const plugin of plugins) visit(plugin);
	return flat;
}
//#endregion
//#region src/head-hint-reload.ts
/**
* Which changed files reach routes with generated client hints.
*
* Head and response-header hints decide whether a dependency edit must reload
* the document; loader hints decide whether it must re-fetch active route data.
* The importer walk is shared because all three are keyed by route source.
*/
function toPosixPath$2(path) {
	return path.replace(/\\/g, "/");
}
function reachesRouteHintedModule(modules, serverRoot, routeHints, options = {}) {
	const pending = options.startAtImporters ? modules.flatMap((module) => [...module.importers ?? []]) : [...modules];
	const seen = /* @__PURE__ */ new Set();
	while (pending.length > 0) {
		const module = pending.pop();
		if (!module || seen.has(module)) continue;
		seen.add(module);
		const modulePath = module.file ?? module.id?.split("?", 1)[0];
		if (modulePath) {
			const normalizedPath = toPosixPath$2(modulePath);
			if (routeHints[normalizedPath.startsWith(serverRoot) ? normalizedPath.slice(serverRoot.length) : normalizedPath] === true) return true;
		}
		if (module.importers) pending.push(...module.importers);
	}
	return false;
}
//#endregion
//#region src/route-data-stale.ts
function sendRouteDataStale(server) {
	const hot = server.environments?.client?.hot;
	if (!hot) return false;
	hot.send({
		type: "custom",
		event: DEV_ROUTE_DATA_STALE_EVENT
	});
	return true;
}
//#endregion
//#region src/hot-update-reload.ts
/**
* True when `file` participates in server rendering but has no runtime
* counterpart in the client module graph, meaning client HMR can never deliver
* its change. File-only asset entries created by content scanners are watchers,
* not browser modules, so they do not make an update client-reachable.
*/
function isServerOnlyModuleFile(server, file) {
	const environments = server.environments;
	const client = environments?.client;
	if (!client) return false;
	if (hasRuntimeModules(client, file)) return false;
	for (const [name, environment] of Object.entries(environments ?? {})) {
		if (name === "client" || !environment) continue;
		if (hasRuntimeModules(environment, file)) return true;
	}
	return false;
}
/** Reload open pages when `file` can only reach them through the server. */
function sendServerOnlyFullReload(server, file) {
	if (!isServerOnlyModuleFile(server, file)) return false;
	server.environments?.client?.hot?.send({ type: "full-reload" });
	return true;
}
function hasRuntimeModules(environment, file) {
	for (const module of environment.moduleGraph.getModulesByFile(file) ?? []) if (module.type !== "asset") return true;
	return false;
}
//#endregion
//#region src/plugin-assets.ts
const PRACHT_CLIENT_MODULE_ID = "virtual:pracht/client";
const PRACHT_SERVER_MODULE_ID = "virtual:pracht/server";
const PRACHT_DEV_MODULE_ID = "virtual:pracht/dev-metadata";
const PRACHT_ISLANDS_CLIENT_MODULE_ID = "virtual:pracht/islands-client";
const PRACHT_CAPABILITIES_MODULE_ID = "virtual:pracht/capabilities";
const PRACHT_WEBMCP_MODULE_ID = "virtual:pracht/webmcp";
const CLIENT_BROWSER_PATH = "/@pracht/client.js";
const ISLANDS_CLIENT_BROWSER_PATH = "/@pracht/islands.js";
/**
* `base` prefixes every emitted asset URL. Vite normalizes it to leading and
* trailing slashes; a CDN base (absolute or protocol-relative) is used as-is,
* so the manifest paths still resolve.
*/
function assetUrl(file, base) {
	return `${base}${file}`;
}
function readClientBuildAssets(root = process.cwd(), base = "/") {
	const manifestPath = ["dist/client/.vite/manifest.json", "dist/.vite/manifest.json"].map((candidate) => resolve(root, candidate)).find((candidate) => existsSync(candidate));
	if (!manifestPath) return {
		clientEntryUrl: null,
		islandsEntryUrl: null,
		cssManifest: {},
		jsManifest: {}
	};
	const rawManifest = readFileSync(manifestPath, "utf-8");
	const manifest = JSON.parse(rawManifest);
	const clientEntry = manifest[PRACHT_CLIENT_MODULE_ID];
	const islandsEntry = manifest[PRACHT_ISLANDS_CLIENT_MODULE_ID];
	const cssManifest = {};
	const jsManifest = {};
	for (const [key, entry] of Object.entries(manifest)) {
		if (!entry.src) continue;
		const deps = collectTransitiveDeps(manifest, key);
		const manifestKey = stripPrachtClientModuleQuery(entry.src);
		if (deps.css.length > 0) cssManifest[manifestKey] = deps.css.map((f) => assetUrl(f, base));
		if (deps.js.length > 0) jsManifest[manifestKey] = deps.js.map((f) => assetUrl(f, base));
	}
	addEntryDeps(manifest, jsManifest, PRACHT_CLIENT_MODULE_ID, clientEntry, base);
	addEntryDeps(manifest, jsManifest, PRACHT_ISLANDS_CLIENT_MODULE_ID, islandsEntry, base);
	return {
		clientEntryUrl: clientEntry ? assetUrl(clientEntry.file, base) : null,
		islandsEntryUrl: islandsEntry ? assetUrl(islandsEntry.file, base) : null,
		cssManifest,
		jsManifest
	};
}
function addEntryDeps(manifest, jsManifest, entryKey, entry, base) {
	if (!entry) return;
	const deps = collectTransitiveDeps(manifest, entryKey).js.filter((file) => file !== entry.file);
	if (deps.length > 0) jsManifest[entryKey] = deps.map((file) => assetUrl(file, base));
}
function collectTransitiveDeps(manifest, key) {
	const css = /* @__PURE__ */ new Set();
	const js = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	function collect(k) {
		if (visited.has(k)) return;
		visited.add(k);
		const entry = manifest[k];
		if (!entry) return;
		for (const c of entry.css ?? []) css.add(c);
		js.add(entry.file);
		for (const imp of entry.imports ?? []) collect(imp);
	}
	collect(key);
	return {
		css: [...css],
		js: [...js]
	};
}
function isClientModule(id) {
	return id === "virtual:pracht/client" || id === "/@pracht/client.js" || id.endsWith("virtual:pracht/client");
}
function isServerModule(id) {
	return id === "virtual:pracht/server" || id.endsWith("virtual:pracht/server");
}
function isDevModule(id) {
	return id === "virtual:pracht/dev-metadata" || id.endsWith("virtual:pracht/dev-metadata");
}
function isIslandsClientModule(id) {
	return id === "virtual:pracht/islands-client" || id === "/@pracht/islands.js" || id.endsWith("virtual:pracht/islands-client");
}
function isCapabilitiesModule(id) {
	return id === "virtual:pracht/capabilities" || id.endsWith("virtual:pracht/capabilities");
}
function isWebmcpModule(id) {
	return id === "virtual:pracht/webmcp" || id.endsWith("virtual:pracht/webmcp");
}
//#endregion
//#region src/plugin-adapter.ts
function createDefaultNodeAdapter() {
	return {
		id: "node",
		serverImports: "import { resolveApp, resolveApiRoutes } from \"@pracht/core/server\";",
		createServerEntryModule() {
			return createNodeServerEntryModule();
		}
	};
}
//#endregion
//#region src/plugin-options.ts
const CLIENT_FEATURE_DEFAULTS = { prefetch: true };
const DEFAULTS = {
	client: CLIENT_FEATURE_DEFAULTS,
	vendorChunk: true,
	appFile: "/src/routes.ts",
	middlewareDir: "/src/middleware",
	routesDir: "/src/routes",
	shellsDir: "/src/shells",
	apiDir: "/src/api",
	serverDir: "/src/server",
	additionalExtensions: [],
	islandsDir: "/src/islands",
	capabilitiesDir: "/src/capabilities",
	adapter: createDefaultNodeAdapter(),
	pagesDir: "",
	pagesDefaultRender: "ssr",
	prerenderConcurrency: 10,
	maxBodySize: 1024 * 1024,
	budgets: {},
	precompileSsrJsx: false,
	envSafety: {},
	llmsTxt: false
};
function resolveOptions(options) {
	const resolved = {
		...DEFAULTS,
		...options
	};
	if (resolved.llmsTxt === void 0) resolved.llmsTxt = false;
	resolved.client = resolveClientOptions(options.client);
	if (typeof resolved.vendorChunk !== "boolean") throw new Error(`pracht({ vendorChunk }) expects a boolean, got ${JSON.stringify(resolved.vendorChunk)}.`);
	resolved.additionalExtensions = normalizeAdditionalExtensions(resolved.additionalExtensions);
	if (!new Set([
		"spa",
		"ssr",
		"ssg",
		"isg"
	]).has(resolved.pagesDefaultRender)) throw new Error("pracht({ pagesDefaultRender }) expects \"spa\", \"ssr\", \"ssg\", or \"isg\".");
	if (!Number.isInteger(resolved.prerenderConcurrency) || resolved.prerenderConcurrency <= 0) throw new Error("pracht({ prerenderConcurrency }) expects a positive integer.");
	if (!Number.isInteger(resolved.maxBodySize) || resolved.maxBodySize <= 0) throw new Error("pracht({ maxBodySize }) expects a positive integer number of bytes.");
	validateBudgets(resolved.budgets);
	validateLlmsTxt(resolved.llmsTxt);
	return resolved;
}
function resolveClientOptions(client) {
	if (client === void 0) return CLIENT_FEATURE_DEFAULTS;
	if (typeof client !== "object" || client === null) throw new Error("pracht({ client }) expects an options object.");
	const resolved = { ...CLIENT_FEATURE_DEFAULTS };
	for (const key of Object.keys(CLIENT_FEATURE_DEFAULTS)) {
		const value = client[key];
		if (value === void 0) continue;
		if (typeof value !== "boolean") throw new Error(`pracht({ client: { ${key} } }) expects a boolean, got ${JSON.stringify(value)}.`);
		resolved[key] = value;
	}
	const unknown = Object.keys(client).filter((key) => !(key in CLIENT_FEATURE_DEFAULTS));
	if (unknown.length > 0) throw new Error(`pracht({ client }) does not accept ${unknown.map((key) => JSON.stringify(key)).join(", ")}. Known features: ${Object.keys(CLIENT_FEATURE_DEFAULTS).join(", ")}.`);
	return resolved;
}
const LLMS_TXT_SECTIONS = new Set([
	"pages",
	"api",
	"capabilities"
]);
function validateLlmsTxt(llmsTxt) {
	if (llmsTxt === false) return;
	if (typeof llmsTxt !== "object" || llmsTxt === null) throw new Error("pracht({ llmsTxt }) expects false or an options object.");
	if (llmsTxt.include !== void 0) {
		if (!(Array.isArray(llmsTxt.include) && llmsTxt.include.every((section) => LLMS_TXT_SECTIONS.has(section)))) throw new Error(`pracht({ llmsTxt: { include } }) expects an array of "pages", "api", and/or "capabilities", got ${JSON.stringify(llmsTxt.include)}.`);
	}
	if (llmsTxt.maxPagesPerRoute !== void 0) {
		const value = llmsTxt.maxPagesPerRoute;
		if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error(`pracht({ llmsTxt: { maxPagesPerRoute } }) expects a non-negative integer (0 lists every page), got ${JSON.stringify(value)}.`);
	}
}
function validateBudgets(budgets) {
	for (const [key, value] of Object.entries(budgets)) {
		if (key !== "*" && !key.startsWith("/")) throw new Error(`pracht({ budgets }) keys must be "*" or a route path starting with "/", got ${JSON.stringify(key)}.`);
		const isValidNumber = typeof value === "number" && Number.isFinite(value) && value > 0;
		const isValidString = typeof value === "string" && value.trim().length > 0;
		if (!isValidNumber && !isValidString) throw new Error(`pracht({ budgets }) values must be a positive number of bytes or a size string like "120kb", got ${JSON.stringify(value)} for ${JSON.stringify(key)}.`);
	}
}
//#endregion
//#region src/plugin-capabilities.ts
/**
* Build-time capability projection for the browser.
*
* The client never loads capability modules (they are server-only), so the
* `virtual:pracht/capabilities` and `virtual:pracht/webmcp` modules are
* generated from static analysis of the app manifest and the registered
* capability sources — the same approach the plugin already uses for
* hydration-mode excludes. Only serializable metadata crosses the boundary:
* capability names, HTTP endpoints, effects, and (for WebMCP tools)
* description and input schema.
*
* The static analyzer itself lives in `@pracht/capabilities/static` and is
* shared with `pracht verify`, so the build and verification can never
* disagree about what is analyzable. Constraint it imposes: a capability's
* `expose`, HTTP-projected `effect`, and WebMCP `input` values must be inline
* literals (no imported constants or spreads) — the extractor parses the
* literal text as data.
* Extraction failures fail the build with a pointer to the offending file
* rather than silently dropping an endpoint.
*/
/**
* Whether the app can reach the agent surface at all — registered capabilities
* or a `defineApp({ agents })` config. Drives the `__PRACHT_AGENT_SURFACE__`
* define, which lets the bundler drop the capability and Web Bot Auth runtimes
* from the server bundle of apps that use neither.
*
* Deliberately one-sided: it only answers `false` when the manifest is readable
* and provably free of both. An unreadable manifest, a parse failure, or any
* spread inside the manifest file (which could carry registrations this
* analyzer cannot see) answers `true`, so the runtime keeps deciding for
* itself. Being wrong the other way would 404 a capability in production that
* works in dev.
*/
function hasAgentSurface(options = {}, root = process.cwd()) {
	const resolved = resolveOptions(options);
	if (resolved.pagesDir) return false;
	const appFileAbs = resolve(root, resolved.appFile.replace(/^\//, ""));
	let manifestSource;
	try {
		manifestSource = readFileSync(appFileAbs, "utf-8");
	} catch {
		return true;
	}
	const appBody = extractDefineAppObjectBody(manifestSource);
	if (appBody === null) return true;
	const properties = scanTopLevelProperties(appBody);
	if (properties.has("agents") || properties.has("capabilities")) return true;
	if (/\b(?:agents|capabilities)\b/.test(appBody)) return true;
	if (appBody.includes("...") || hasOpaqueTopLevelProperty(appBody)) return true;
	try {
		return extractCapabilityRegistrations(manifestSource).length > 0;
	} catch {
		return true;
	}
}
/** Whether an object literal body contains an opaque key at its top level. */
function hasOpaqueTopLevelProperty(objectBody) {
	let braces = 0;
	let brackets = 0;
	let parentheses = 0;
	let expectingKey = true;
	for (let index = 0; index < objectBody.length; index += 1) {
		const char = objectBody[index];
		const next = objectBody[index + 1];
		if (char === "\"" || char === "'" || char === "`") {
			const quote = char;
			for (index += 1; index < objectBody.length; index += 1) if (objectBody[index] === "\\") index += 1;
			else if (objectBody[index] === quote) break;
			continue;
		}
		if (char === "/" && next === "/") {
			index = objectBody.indexOf("\n", index + 2);
			if (index === -1) break;
			continue;
		}
		if (char === "/" && next === "*") {
			const end = objectBody.indexOf("*/", index + 2);
			if (end === -1) return true;
			index = end + 1;
			continue;
		}
		if (char === "/") return true;
		const atTopLevel = braces === 0 && brackets === 0 && parentheses === 0;
		if (atTopLevel && expectingKey && char === "[") return true;
		if (atTopLevel && expectingKey && char === "\\") return true;
		if (atTopLevel && char === ":") expectingKey = false;
		if (atTopLevel && char === ",") expectingKey = true;
		if (char === "{") braces += 1;
		else if (char === "}") braces -= 1;
		else if (char === "[") brackets += 1;
		else if (char === "]") brackets -= 1;
		else if (char === "(") parentheses += 1;
		else if (char === ")") parentheses -= 1;
	}
	return false;
}
/**
* Extract capability registrations (name → module path) from the app
* manifest source and their exposure metadata from each capability source.
* Pages-router apps have no manifest, so capabilities are manifest-mode only.
*/
function extractCapabilities(options = {}, root = process.cwd()) {
	const resolved = resolveOptions(options);
	if (resolved.pagesDir) return [];
	const appFileAbs = resolve(root, resolved.appFile.replace(/^\//, ""));
	let manifestSource;
	try {
		manifestSource = readFileSync(appFileAbs, "utf-8");
	} catch {
		return [];
	}
	const registrations = extractCapabilityRegistrations(manifestSource);
	if (registrations.length === 0) return [];
	const appDir = dirname(appFileAbs);
	return registrations.map(({ name, file }) => {
		const capabilityFileAbs = file.startsWith("/") ? resolve(root, file.replace(/^\//, "")) : resolve(appDir, file);
		let source;
		try {
			source = readFileSync(capabilityFileAbs, "utf-8");
		} catch {
			throw new Error(`[pracht] Capability "${name}" references missing file ${JSON.stringify(file)}.`);
		}
		return extractCapabilityMetadata(name, file, source);
	});
}
/**
* Absolute paths of the capability modules the manifest registers.
*
* The client-import guard uses this rather than a `capabilitiesDir` prefix
* test: registration is what makes a module server-only, and the manifest may
* point anywhere. A directory test both misses capabilities registered from
* elsewhere and wrongly rejects ordinary co-located files (shared constants,
* types) that happen to sit in the capability folder.
*
* Returns an empty list when the manifest cannot be read or parsed — the
* virtual-module generation raises its own precise error for those, and
* guessing here would turn one clear failure into two confusing ones.
*/
function resolveCapabilityModulePaths(options = {}, root = process.cwd()) {
	const resolved = resolveOptions(options);
	if (resolved.pagesDir) return [];
	const appFileAbs = resolve(root, resolved.appFile.replace(/^\//, ""));
	let manifestSource;
	try {
		manifestSource = readFileSync(appFileAbs, "utf-8");
	} catch {
		return [];
	}
	const appDir = dirname(appFileAbs);
	return extractCapabilityRegistrations(manifestSource).map(({ file }) => file.startsWith("/") ? resolve(root, file.replace(/^\//, "")) : resolve(appDir, file));
}
function extractCapabilityMetadata(name, file, source) {
	return {
		name,
		file,
		...extractCapabilityProjection(name, source, (detail) => `[pracht] Capability ${JSON.stringify(name)} (${file}) ${detail}`)
	};
}
/**
* Generate `virtual:pracht/capabilities` — the browser-side `callCapability`
* helper plus the endpoint map for http-exposed capabilities. Side-effect
* free, so it costs zero bytes unless application code imports it.
*
* After every call settles, the helper announces itself on
* CAPABILITY_SETTLED_EVENT with the capability's effect class; the framework
* runtime revalidates route data for successful non-`read` calls (opt out
* per call via `{ revalidate: false }`).
*/
function createPrachtCapabilitiesClientModuleSource(options = {}, buildOptions = {}) {
	const capabilities = extractCapabilities(options, buildOptions.root);
	const endpoints = Object.create(null);
	for (const capability of capabilities) if (capability.httpPath) endpoints[capability.name] = {
		method: "POST",
		path: capability.httpPath,
		effect: capability.effect
	};
	return [
		"// Generated by @pracht/vite-plugin from the app manifest capability registrations.",
		"// Contains only http-exposed capability names, endpoints, and effects —",
		"// capability modules themselves are server-only and never reach the client graph.",
		"import { createUseCapability, ensureCapabilityRevalidation, withBase } from \"@pracht/core\";",
		"",
		`const endpoints = Object.assign(Object.create(null), JSON.parse(${JSON.stringify(JSON.stringify(endpoints))}));`,
		"",
		"export const capabilityEndpoints = endpoints;",
		"",
		"async function dispatchCapability(endpoint, input, opts) {",
		"  let response;",
		"  try {",
		"    const headers = new Headers(opts && opts.headers);",
		"    headers.set(\"content-type\", \"application/json\");",
		"    if (opts && opts.prepare) {",
		`      headers.delete(${JSON.stringify(CONFIRMATION_HEADER)});`,
		"    } else if (opts && opts.confirm) {",
		`      headers.set(${JSON.stringify(CONFIRMATION_HEADER)}, opts.confirm);`,
		"    }",
		"    response = await fetch(withBase(endpoint.path), {",
		"      method: endpoint.method,",
		"      headers,",
		"      body: JSON.stringify(input === undefined ? {} : input),",
		"      credentials: \"same-origin\",",
		"      signal: opts && opts.signal,",
		"    });",
		"  } catch (error) {",
		"    return {",
		"      ok: false,",
		"      error: { code: \"network_error\", message: String((error && error.message) || error) },",
		"    };",
		"  }",
		"  let result;",
		"  try {",
		"    result = await response.json();",
		"  } catch {",
		"    return {",
		"      ok: false,",
		"      error: {",
		"        code: \"invalid_response\",",
		"        message: `Capability endpoint returned a non-JSON response (status ${response.status}).`,",
		"      },",
		"    };",
		"  }",
		"  if (",
		"    !result || typeof result !== \"object\" ||",
		"    (result.ok !== true && result.ok !== false) ||",
		"    (result.ok === true && !(\"data\" in result)) ||",
		"    (result.ok === false &&",
		"      (!result.error || typeof result.error !== \"object\" ||",
		"        typeof result.error.code !== \"string\" || typeof result.error.message !== \"string\"))",
		"  ) {",
		"    return {",
		"      ok: false,",
		"      error: {",
		"        code: \"invalid_response\",",
		"        message: `Capability endpoint returned an invalid envelope (status ${response.status}).`,",
		"      },",
		"    };",
		"  }",
		"  return result;",
		"}",
		"",
		"export async function callCapability(name, input, opts) {",
		"  ensureCapabilityRevalidation();",
		"  const endpoint = endpoints[name];",
		"  if (!endpoint) {",
		"    return {",
		"      ok: false,",
		"      error: {",
		"        code: \"unknown_capability\",",
		"        message: `No HTTP-exposed capability named \"${name}\" is registered.`,",
		"      },",
		"    };",
		"  }",
		"  const result = await dispatchCapability(endpoint, input, opts);",
		"  // Announce the settled call so the route runtime can revalidate after",
		"  // successful non-read effects. Best-effort — never breaks the call.",
		"  try {",
		"    if (typeof window !== \"undefined\") {",
		`      window.dispatchEvent(new CustomEvent(${JSON.stringify(CAPABILITY_SETTLED_EVENT)}, {`,
		"        detail: {",
		"          name,",
		"          effect: endpoint.effect,",
		"          ok: result && result.ok === true,",
		"          revalidate: opts && opts.revalidate === false ? false : undefined,",
		"        },",
		"      }));",
		"    }",
		"  } catch {}",
		"  return result;",
		"}",
		"",
		"// Nested client: dotted capability names become object paths, so",
		"// `capabilities.notes.search(input)` calls `callCapability(\"notes.search\", input)`.",
		"// Built from the same endpoint table, so there is one dispatch path.",
		"function buildCapabilityClient(names) {",
		"  const root = Object.create(null);",
		"  for (const name of names) {",
		"    const segments = name.split(\".\");",
		"    const leaf = segments.pop();",
		"    let node = root;",
		"    for (const segment of segments) {",
		"      // A name that is both a namespace and a leaf (`a` plus `a.b`) would",
		"      // collide; the namespace wins and the leaf stays reachable through",
		"      // callCapability(). `pracht verify` reports the shadowed name.",
		"      if (typeof node[segment] !== \"object\" || node[segment] === null) {",
		"        node[segment] = Object.create(null);",
		"      }",
		"      node = node[segment];",
		"    }",
		"    if (typeof node[leaf] !== \"object\") {",
		"      node[leaf] = (input, opts) => callCapability(name, input, opts);",
		"    }",
		"  }",
		"  return root;",
		"}",
		"",
		"export const capabilities = /*@__PURE__*/ buildCapabilityClient(Object.keys(endpoints));",
		"",
		"// The hook's implementation lives in @pracht/core (typed and unit-tested);",
		"// only the app-specific dispatch is bound here, so every projection shares",
		"// one call path. Pure-annotated: apps that never call it pay nothing.",
		"export const useCapability = /*@__PURE__*/ createUseCapability(callCapability);",
		""
	].join("\n");
}
/**
* Generate `virtual:pracht/webmcp` — the disposable WebMCP registration shim.
* One page tool per `expose.webmcp` capability; `execute` dispatches through
* `callCapability`, so the user's session authenticates the call and all
* validation/middleware/policy stays server-side. Each dispatch carries the
* transport marker header so audit events can attribute it to WebMCP.
*
* Targets the WebMCP CG draft API: `document.modelContext.registerTool()`
* (ChatGPT desktop's built-in browser; Chromium 150+ within the 149–156
* origin trial — the `document` getter landed in 150 and the deprecated
* `navigator.modelContext` alias was removed in 152, so trial builds before
* 150 are not targeted and no fallback is kept; current polyfills install the
* `document` shape). No-ops silently when the API is absent.
*
* `execute()` returns the capability envelope (`{ ok, data }` /
* `{ ok: false, error }`) as a plain object: per the spec the host serializes
* the returned value itself, so wrapping it in MCP-style content blocks would
* reach the agent double-encoded.
*/
function createPrachtWebmcpModuleSource(options = {}, buildOptions = {}) {
	const tools = extractCapabilities(options, buildOptions.root).filter((capability) => capability.webmcp).map((capability) => ({
		name: capability.name,
		...capability.title ? { title: capability.title } : {},
		description: capability.description,
		inputSchema: capability.inputSchema,
		annotations: {
			readOnlyHint: capability.effect === "read",
			...capability.effect === "read" ? { destructiveHint: false } : {},
			idempotentHint: capability.effect === "read",
			...capability.webmcpUntrustedContent ? { untrustedContentHint: true } : {}
		}
	}));
	return [
		"// Generated by @pracht/vite-plugin — WebMCP page-tool registration shim.",
		"import { callCapability } from \"virtual:pracht/capabilities\";",
		"",
		`const tools = ${JSON.stringify(tools)};`,
		`const transportHeaders = { ${JSON.stringify(CAPABILITY_TRANSPORT_HEADER)}: "webmcp" };`,
		"",
		"export function registerPrachtWebmcpTools() {",
		"  const modelContext =",
		"    (typeof document !== \"undefined\" && document.modelContext) || null;",
		"  if (!modelContext || typeof modelContext.registerTool !== \"function\") {",
		"    return false;",
		"  }",
		"  for (const tool of tools) {",
		"    try {",
		"      const registration = modelContext.registerTool({",
		"        ...tool,",
		"        async execute(input, { signal } = {}) {",
		"          return callCapability(tool.name, input, {",
		"            headers: transportHeaders,",
		"            signal,",
		"          });",
		"        },",
		"      });",
		"      if (registration && typeof registration.catch === \"function\") {",
		"        registration.catch(() => {});",
		"      }",
		"    } catch {",
		"      // The API is still an origin-trial surface; a failed registration",
		"      // must never break the page.",
		"    }",
		"  }",
		"  return true;",
		"}",
		"",
		"registerPrachtWebmcpTools();",
		""
	].join("\n");
}
/**
* Snippet appended to the client entry / islands bootstrap when at least one
* capability opts into WebMCP. Feature-detects before importing so browsers
* without the origin trial never pay for the shim chunk.
*/
function createWebmcpBootstrapSource() {
	return [
		"// WebMCP page tools — loaded only when the browser exposes the API.",
		"if (typeof document !== \"undefined\" && document.modelContext) {",
		"  import(\"virtual:pracht/webmcp\").catch(() => {});",
		"}",
		""
	];
}
function hasWebmcpCapabilities(options = {}, root = process.cwd()) {
	try {
		return extractCapabilities(options, root).some((capability) => capability.webmcp);
	} catch {
		return true;
	}
}
//#endregion
//#region src/plugin-codegen.ts
const NON_FULL_HYDRATION_RE = /hydration\s*:\s*["'](?:islands|none)["']/;
const FULL_HYDRATION_RE = /hydration\s*:\s*["']full["']/;
const PAGES_NON_FULL_HYDRATION_RE = /export\s+const\s+HYDRATION\s*=\s*["'](?:islands|none)["']/;
function toPosixPath$1(path) {
	return path.replace(/\\/g, "/");
}
function findMatching(source, start, open, close) {
	let depth = 0;
	for (let i = start; i < source.length; i++) {
		const ch = source[i];
		if (ch === open) depth++;
		if (ch === close) {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}
function scanFiles(dir, files, extensions) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = join(dir, entry);
		let stat;
		try {
			stat = statSync(abs);
		} catch {
			continue;
		}
		if (stat.isDirectory()) scanFiles(abs, files, extensions);
		else if (extensions.has(extname(entry))) files.push(abs);
	}
}
function createNonFullHydrationExcludes(resolved, root = process.cwd()) {
	const excludes = /* @__PURE__ */ new Set();
	if (resolved.pagesDir) {
		const files = [];
		scanFiles(resolve(root, resolved.pagesDir.replace(/^\//, "")), files, withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, resolved.additionalExtensions));
		for (const file of files) try {
			if (PAGES_NON_FULL_HYDRATION_RE.test(readFileSync(file, "utf-8"))) excludes.add(`!/${toPosixPath$1(file).replace(toPosixPath$1(root).replace(/\/$/, "") + "/", "")}`);
		} catch {}
		return [...excludes];
	}
	const appFile = resolve(root, resolved.appFile.replace(/^\//, ""));
	let source;
	try {
		source = readFileSync(appFile, "utf-8");
	} catch {
		return [];
	}
	const groups = [];
	for (const match of source.matchAll(/\bgroup\s*\(/g)) {
		const parenStart = match.index + match[0].lastIndexOf("(");
		const parenEnd = findMatching(source, parenStart, "(", ")");
		if (parenEnd === -1) continue;
		const args = source.slice(parenStart + 1, parenEnd);
		const arrayStart = source.indexOf("[", parenStart);
		if (arrayStart === -1 || arrayStart > parenEnd) continue;
		const arrayEnd = findMatching(source, arrayStart, "[", "]");
		if (arrayEnd === -1) continue;
		groups.push({
			start: arrayStart,
			end: arrayEnd,
			nonFull: NON_FULL_HYDRATION_RE.test(args.split("[")[0] ?? "")
		});
	}
	const appDir = dirname(appFile);
	for (const match of source.matchAll(/\broute\s*\(\s*[^,]+,\s*(?:(?:\(\s*\)\s*=>\s*import\s*\(\s*)?["']([^"']+)["']\s*\)?|["']([^"']+)["'])/g)) {
		const fileRef = match[1] ?? match[2];
		const callStart = match.index;
		const parenStart = source.indexOf("(", callStart);
		const parenEnd = findMatching(source, parenStart, "(", ")");
		if (parenEnd === -1) continue;
		const callSource = source.slice(parenStart, parenEnd);
		const ownNonFull = NON_FULL_HYDRATION_RE.test(callSource);
		const ownFull = FULL_HYDRATION_RE.test(callSource);
		const inheritedNonFull = groups.filter((group) => group.start < callStart && callStart < group.end).sort((a, b) => b.start - a.start)[0]?.nonFull;
		if (ownFull || !ownNonFull && inheritedNonFull !== true) continue;
		const abs = resolve(appDir, fileRef);
		excludes.add(`!/${toPosixPath$1(abs).replace(toPosixPath$1(root).replace(/\/$/, "") + "/", "")}`);
	}
	return [...excludes];
}
function createPrachtClientModuleSource(options = {}, buildOptions = {}) {
	const resolved = resolveOptions(options);
	const isPagesMode = !!resolved.pagesDir;
	const routeLoaderHints = createRouteLoaderHintsForVirtualModules(resolved, buildOptions.root);
	const routeHeadHints = createRouteHeadHintsForVirtualModules(resolved, buildOptions.root);
	const routeStaticPathsHints = createRouteStaticPathsHintsForVirtualModules(resolved, buildOptions.root);
	const appImport = isPagesMode ? generatePagesAppInlineSource(resolved, buildOptions.root) : `import { app } from ${JSON.stringify(resolved.appFile)};`;
	const bareRouteExtensions = [...withAdditionalExtensions(LEGACY_BARE_ROUTE_EXTENSIONS, resolved.additionalExtensions)];
	const dirPrefix = isPagesMode ? resolved.pagesDir : resolved.routesDir;
	const routeGlob = `${dirPrefix}/**/*.{ts,tsx,js,jsx,md,mdx}`;
	const additionalRouteGlob = `${dirPrefix}/**/*.${extensionGlob(bareRouteExtensions)}`;
	const routeExcludes = createNonFullHydrationExcludes(resolved, buildOptions.root);
	const routeGlobPattern = routeExcludes.length > 0 ? [routeGlob, ...routeExcludes] : routeGlob;
	const additionalRouteGlobPattern = additionalRouteGlob && routeExcludes.length > 0 ? [additionalRouteGlob, ...routeExcludes] : additionalRouteGlob;
	const shellGlob = isPagesMode ? `${resolved.pagesDir}/**/_app.{ts,tsx,js,jsx}` : `${resolved.shellsDir}/**/*.{ts,tsx,js,jsx,md,mdx}`;
	const additionalShellGlob = isPagesMode ? `${resolved.pagesDir}/**/_app.${extensionGlob(bareRouteExtensions)}` : `${resolved.shellsDir}/**/*.${extensionGlob(bareRouteExtensions)}`;
	const appFilePosix = resolved.appFile.replace(/\\/g, "/").replace(/^\.\//, "");
	const appDir = (appFilePosix.startsWith("/") ? appFilePosix : `/${appFilePosix}`).replace(/\/[^/]*$/, "") || "/";
	return [
		"import { resolveApp, initClientRouter, readHydrationState, DEV_ROUTE_DATA_STALE_EVENT, refreshDevRouteData } from \"@pracht/core/client\";",
		appImport,
		"",
		`const routeLoaderHints = ${JSON.stringify(routeLoaderHints)};`,
		`const routeHeadHints = ${JSON.stringify(routeHeadHints)};`,
		`const routeStaticPathsHints = ${JSON.stringify(routeStaticPathsHints)};`,
		`const routeModules = {`,
		`  ...import.meta.glob(${JSON.stringify(routeGlobPattern)}, { query: ${JSON.stringify(PRACHT_CLIENT_MODULE_QUERY)} }),`,
		`  ...import.meta.glob(${JSON.stringify(additionalRouteGlobPattern)}),`,
		`};`,
		`const shellModules = {`,
		`  ...import.meta.glob(${JSON.stringify(shellGlob)}, { query: ${JSON.stringify(PRACHT_CLIENT_MODULE_QUERY)} }),`,
		`  ...import.meta.glob(${JSON.stringify(additionalShellGlob)}),`,
		`};`,
		"",
		"const resolvedApp = resolveApp(app);",
		"applyRouteHints(resolvedApp, routeLoaderHints, routeHeadHints, routeStaticPathsHints);",
		"",
		...createApplyRouteLoaderHintsSource(),
		`const APP_DIR = ${JSON.stringify(appDir)};`,
		"",
		"// Manifest refs are written relative to the app manifest file",
		"// (\"./routes/home.tsx\") while import.meta.glob keys are root-absolute",
		"// (\"/src/routes/home.tsx\"). Both sides canonicalize against APP_DIR —",
		"// known at build time — replacing the previous runtime suffix index.",
		"function canonicalModuleKey(path) {",
		"  const raw = path.split(\"?\")[0];",
		"  const joined = raw.startsWith(\"/\") ? raw : APP_DIR + \"/\" + raw;",
		"  const parts = [];",
		"  for (const segment of joined.split(\"/\")) {",
		"    if (!segment || segment === \".\") continue;",
		"    if (segment === \"..\") parts.pop();",
		"    else parts.push(segment);",
		"  }",
		"  return \"/\" + parts.join(\"/\");",
		"}",
		"",
		"const moduleKeyIndexes = new WeakMap();",
		"function getModuleKeyIndex(modules) {",
		"  let index = moduleKeyIndexes.get(modules);",
		"  if (index) return index;",
		"  index = new Map();",
		"  for (const key of Object.keys(modules)) index.set(canonicalModuleKey(key), key);",
		"  moduleKeyIndexes.set(modules, index);",
		"  return index;",
		"}",
		"",
		"function findModuleKey(modules, file) {",
		"  if (file in modules) return file;",
		"  const key = getModuleKeyIndex(modules).get(canonicalModuleKey(file));",
		"  if (key != null) return key;",
		"  if (import.meta.env?.DEV) {",
		"    // Dev-only lenient fallback so refs that never canonicalize (written",
		"    // relative to a file other than the app manifest) keep working while",
		"    // the console error tells the author to fix them — production builds",
		"    // resolve strictly and drop this branch.",
		"    const suffix = \"/\" + file.split(\"?\")[0].replace(/^\\.?\\//, \"\");",
		"    for (const candidate of Object.keys(modules)) {",
		"      if (canonicalModuleKey(candidate).endsWith(suffix)) {",
		"        console.error(",
		"          `[pracht] Module ref ${JSON.stringify(file)} only resolved by suffix matching ` +",
		"            `against ${JSON.stringify(candidate)}. Write manifest refs relative to the app ` +",
		"            `manifest file (e.g. \"./routes/home.tsx\") — suffix matching is disabled in ` +",
		"            `production builds.`,",
		"        );",
		"        return candidate;",
		"      }",
		"    }",
		"  }",
		"  return null;",
		"}",
		"",
		"const state = readHydrationState();",
		"const root = document.getElementById(\"pracht-root\");",
		"if (state && root) {",
		"  initClientRouter({",
		"    app: resolvedApp,",
		"    routeModules,",
		"    shellModules,",
		"    initialState: state,",
		"    root,",
		"    findModuleKey,",
		"  });",
		"}",
		"",
		"// A route module's loader, head, and getStaticPaths are stripped",
		"// out of the browser copy, so Fast Refresh patching the component in place",
		"// leaves the page holding data the server would no longer send. The dev",
		"// server says when that happened; re-fetching route state is what the full",
		"// page reload used to deliver as a side effect. This entry is the only",
		"// module in the graph with an import.meta.hot of its own — an installed",
		"// @pracht/core is a pre-bundled dependency and has none. Production builds",
		"// replace import.meta.hot with undefined and drop the whole branch.",
		"if (import.meta.hot) {",
		"  import.meta.hot.on(DEV_ROUTE_DATA_STALE_EVENT, refreshDevRouteData);",
		"}",
		"",
		...hasWebmcpCapabilities(resolved, buildOptions.root) ? createWebmcpBootstrapSource() : []
	].join("\n");
}
/**
* Source of `virtual:pracht/islands-client` — the tiny bootstrap loaded by
* `hydration: "islands"` routes. It deliberately does NOT import the app
* manifest, the router, or the full client runtime: it only scans the DOM
* for island markers and hydrates the islands present on the page.
*/
function createPrachtIslandsClientModuleSource(options = {}, buildOptions = {}) {
	const resolved = resolveOptions(options);
	const islandsGlob = `${resolved.islandsDir}/**/*.{ts,tsx,js,jsx}`;
	return [
		"import { hydrateIslands } from \"@pracht/core/islands-client\";",
		"",
		`const islandModules = import.meta.glob(${JSON.stringify(islandsGlob)});`,
		"",
		"hydrateIslands({ modules: islandModules });",
		"",
		...hasWebmcpCapabilities(resolved, buildOptions.root) ? createWebmcpBootstrapSource() : []
	].join("\n");
}
function createPrachtServerModuleSource(options = {}, buildOptions = {}) {
	const resolved = resolveOptions(options);
	const isPagesMode = !!resolved.pagesDir;
	const registrySource = createPrachtRegistryModuleSource(resolved);
	const routeLoaderHints = createRouteLoaderHintsForVirtualModules(resolved, buildOptions.root);
	const routeHeadHints = createRouteHeadHintsForVirtualModules(resolved, buildOptions.root);
	const routeStaticPathsHints = createRouteStaticPathsHintsForVirtualModules(resolved, buildOptions.root);
	const clientBuild = buildOptions.isBuild ? readClientBuildAssets(buildOptions.root, buildOptions.base ?? "/") : {
		clientEntryUrl: null,
		islandsEntryUrl: null,
		cssManifest: {},
		jsManifest: {}
	};
	const adapter = resolved.adapter;
	const llmsTxtConfig = resolveLlmsTxtConfig(resolved, buildOptions.root);
	const islandsBootstrapRequired = hasWebmcpCapabilities(resolved, buildOptions.root);
	let prachtImports = adapter?.serverImports ? adapter.serverImports + "\nimport { prerenderApp } from \"@pracht/core/server\";" : "import { resolveApp, resolveApiRoutes, prerenderApp } from \"@pracht/core/server\";";
	if (llmsTxtConfig) prachtImports += "\nimport { buildLlmsTxt } from \"@pracht/core/server\";";
	const appImport = isPagesMode ? generatePagesAppInlineSource(resolved, buildOptions.root) : `import { app } from ${JSON.stringify(resolved.appFile)};`;
	const devBase = buildOptions.base ?? "/";
	const withDevBase = (path) => devBase === "/" ? path : `${devBase}${path.slice(1)}`;
	const clientEntryUrl = buildOptions.isBuild ? clientBuild.clientEntryUrl : withDevBase(CLIENT_BROWSER_PATH);
	const islandsEntryUrl = buildOptions.isBuild ? clientBuild.islandsEntryUrl : withDevBase(ISLANDS_CLIENT_BROWSER_PATH);
	const islandsGlob = `${resolved.islandsDir}/**/*.{ts,tsx,js,jsx}`;
	const source = [
		prachtImports,
		"import { registerServerIslands, setIslandsClientEntryUrl } from \"@pracht/core/server\";",
		appImport,
		"",
		`const routeLoaderHints = ${JSON.stringify(routeLoaderHints)};`,
		`const routeHeadHints = ${JSON.stringify(routeHeadHints)};`,
		`const routeStaticPathsHints = ${JSON.stringify(routeStaticPathsHints)};`,
		...createApplyRouteLoaderHintsSource(),
		registrySource,
		"",
		"// Islands are registered eagerly so the server renderer can detect their",
		"// vnodes during islands-mode renders.",
		`const islandModules = import.meta.glob(${JSON.stringify(islandsGlob)}, { eager: true });`,
		"registerServerIslands(islandModules);",
		`setIslandsClientEntryUrl(${JSON.stringify(islandsEntryUrl ?? void 0)});`,
		"export const islandFiles = Object.keys(islandModules);",
		"",
		"export const resolvedApp = resolveApp(app);",
		"applyRouteHints(resolvedApp, routeLoaderHints, routeHeadHints, routeStaticPathsHints);",
		`export const apiRoutes = resolveApiRoutes(Object.keys(apiModules), ${JSON.stringify(resolved.apiDir)});`,
		`export const buildTarget = ${JSON.stringify(adapter?.id ?? "node")};`,
		`export const staticTarget = ${JSON.stringify(adapter?.staticTarget === true)};`,
		`export const buildBase = ${JSON.stringify(buildOptions.base ?? "/")};`,
		`export const configuredBase = ${JSON.stringify(buildOptions.configuredBase)};`,
		`export const clientEntryUrl = ${JSON.stringify(clientEntryUrl ?? "/@pracht/client.js")};`,
		`export const islandsEntryUrl = ${JSON.stringify(islandsEntryUrl ?? null)};`,
		`export const islandsBootstrapRequired = ${JSON.stringify(islandsBootstrapRequired)};`,
		`export const cssManifest = ${JSON.stringify(clientBuild.cssManifest)};`,
		`export const jsManifest = ${JSON.stringify(clientBuild.jsManifest)};`,
		`export const prerenderConcurrency = ${JSON.stringify(resolved.prerenderConcurrency)};`,
		`export const budgets = ${JSON.stringify(resolved.budgets)};`,
		"export { prerenderApp };",
		...llmsTxtConfig ? [
			"// llms.txt (https://llmstxt.org) generated from the resolved app graph.",
			"// `pracht build` writes it to dist/client/llms.txt; the dev SSR",
			"// middleware serves it at /llms.txt.",
			`const llmsTxtConfig = ${JSON.stringify(llmsTxtConfig)};`,
			"export const generateLlmsTxt = () =>",
			"  buildLlmsTxt({ ...llmsTxtConfig, apiRoutes, app: resolvedApp, registry });"
		] : [],
		""
	];
	if (adapter) source.push(adapter.createServerEntryModule());
	return source.join("\n");
}
/**
* Adapter-neutral app metadata used by development tooling. Keeping this
* separate from the server entry avoids evaluating worker-only imports (for
* example `cloudflare:workers`) in Vite's Node SSR environment.
*/
function createPrachtDevModuleSource(options = {}, buildOptions = {}) {
	const resolved = resolveOptions(options);
	const routeLoaderHints = createRouteLoaderHintsForVirtualModules(resolved, buildOptions.root);
	const routeHeadHints = createRouteHeadHintsForVirtualModules(resolved, buildOptions.root);
	const routeStaticPathsHints = createRouteStaticPathsHintsForVirtualModules(resolved, buildOptions.root);
	return [
		"import { resolveApp, resolveApiRoutes } from \"@pracht/core/server\";",
		resolved.pagesDir ? generatePagesAppInlineSource(resolved, buildOptions.root) : `import { app } from ${JSON.stringify(resolved.appFile)};`,
		"",
		`const routeLoaderHints = ${JSON.stringify(routeLoaderHints)};`,
		`const routeHeadHints = ${JSON.stringify(routeHeadHints)};`,
		`const routeStaticPathsHints = ${JSON.stringify(routeStaticPathsHints)};`,
		...createApplyRouteLoaderHintsSource(),
		createPrachtRegistryModuleSource(resolved),
		"",
		"export const resolvedApp = resolveApp(app);",
		"applyRouteHints(resolvedApp, routeLoaderHints, routeHeadHints, routeStaticPathsHints);",
		`export const apiRoutes = resolveApiRoutes(Object.keys(apiModules), ${JSON.stringify(resolved.apiDir)});`,
		`export const buildTarget = ${JSON.stringify(resolved.adapter?.id ?? "node")};`,
		`export const staticTarget = ${JSON.stringify(resolved.adapter?.staticTarget === true)};`,
		`export const buildBase = ${JSON.stringify(buildOptions.base ?? "/")};`,
		""
	].join("\n");
}
/**
* Fill llms.txt title/description from the app's package.json when the user
* did not set them explicitly. Returns null when the feature is disabled so
* the server module codegen stays byte-for-byte unchanged.
*/
function resolveLlmsTxtConfig(resolved, root = process.cwd()) {
	if (!resolved.llmsTxt) return null;
	let pkg = {};
	try {
		pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
	} catch {}
	const config = { title: resolved.llmsTxt.title ?? (typeof pkg.name === "string" && pkg.name ? pkg.name : "App") };
	const description = resolved.llmsTxt.description ?? (typeof pkg.description === "string" && pkg.description ? pkg.description : void 0);
	if (description) config.description = description;
	if (resolved.llmsTxt.origin) config.origin = resolved.llmsTxt.origin;
	if (resolved.llmsTxt.include) config.include = resolved.llmsTxt.include;
	if (resolved.llmsTxt.exclude?.length) config.exclude = resolved.llmsTxt.exclude;
	if (resolved.llmsTxt.maxPagesPerRoute !== void 0) config.maxPagesPerRoute = resolved.llmsTxt.maxPagesPerRoute;
	return config;
}
function createApplyRouteLoaderHintsSource() {
	return [
		"function applyRouteHints(resolvedApp, routeLoaderHints, routeHeadHints, routeStaticPathsHints) {",
		"  for (const route of resolvedApp.routes) {",
		"    const hint = routeLoaderHints[route.file];",
		"    if (hint === true) {",
		"      route.hasLoader = true;",
		"    } else if (typeof route.hasLoader === 'undefined' && typeof hint === 'boolean') {",
		"      route.hasLoader = hint;",
		"    }",
		"    const routeHeadHint = routeHeadHints[route.file];",
		"    const shellHeadHint = route.shellFile ? routeHeadHints[route.shellFile] : undefined;",
		"    const hasCompleteHeadHints = typeof routeHeadHint === 'boolean' &&",
		"      (!route.shellFile || typeof shellHeadHint === 'boolean');",
		"    if (routeHeadHint === true || shellHeadHint === true) {",
		"      route.hasHead = true;",
		"    } else if (typeof route.hasHead === 'undefined' && hasCompleteHeadHints) {",
		"      route.hasHead = routeHeadHint === true || shellHeadHint === true;",
		"    }",
		"    // Only ever narrows to false, and only when the scan actually saw the",
		"    // module: an unknown route file keeps today's conservative behavior.",
		"    const staticPathsHint = routeStaticPathsHints[route.file];",
		"    if (typeof route.hasStaticPaths === 'undefined' && typeof staticPathsHint === 'boolean') {",
		"      route.hasStaticPaths = staticPathsHint;",
		"    }",
		"  }",
		"}",
		""
	];
}
function createRouteHeadHintsForVirtualModules(options, root = process.cwd()) {
	const appFileDir = dirname(resolve(root, options.appFile.slice(1)));
	const directories = options.pagesDir ? [[options.pagesDir, resolve(root, options.pagesDir.slice(1))]] : [[options.routesDir, resolve(root, options.routesDir.slice(1))], [options.shellsDir, resolve(root, options.shellsDir.slice(1))]];
	return Object.assign({}, ...directories.map(([prefix, directory]) => createRouteHeadHints(directory, {
		additionalExtensions: options.additionalExtensions,
		appFileDir,
		rootRelativePrefix: prefix
	})));
}
function createRouteHeadersHintsForVirtualModules(options, root = process.cwd()) {
	if (options.pagesDir) return createRouteHeadersHints(resolve(root, options.pagesDir.slice(1)), {
		additionalExtensions: options.additionalExtensions,
		rootRelativePrefix: options.pagesDir
	});
	const appFileDir = dirname(resolve(root, options.appFile.slice(1)));
	const directories = [[options.routesDir, resolve(root, options.routesDir.slice(1))], [options.shellsDir, resolve(root, options.shellsDir.slice(1))]];
	return Object.assign({}, ...directories.map(([prefix, directory]) => createRouteHeadersHints(directory, {
		additionalExtensions: options.additionalExtensions,
		appFileDir,
		rootRelativePrefix: prefix
	})));
}
/**
* `getStaticPaths()` presence per route file. Only routes matter — a shell
* cannot enumerate paths — so unlike the head hints this skips the shells
* directory.
*/
function createRouteStaticPathsHintsForVirtualModules(options, root = process.cwd()) {
	const appFileDir = dirname(resolve(root, options.appFile.slice(1)));
	const routesPrefix = options.pagesDir || options.routesDir;
	return createRouteStaticPathsHints(resolve(root, routesPrefix.slice(1)), {
		additionalExtensions: options.additionalExtensions,
		appFileDir,
		rootRelativePrefix: routesPrefix
	});
}
function createRouteLoaderHintsForVirtualModules(options, root = process.cwd()) {
	if (options.pagesDir) {
		const pages = scanPagesDirectory(resolve(root, options.pagesDir.slice(1)), options.additionalExtensions);
		const hints = {};
		for (const page of pages) {
			const key = `${options.pagesDir}/${page.relativePath.replace(/\\/g, "/")}`;
			hints[key] = !!page.hasLoader;
		}
		return hints;
	}
	const appFileDir = dirname(resolve(root, options.appFile.slice(1)));
	return createRouteLoaderHints(resolve(root, options.routesDir.slice(1)), {
		additionalExtensions: options.additionalExtensions,
		appFileDir,
		rootRelativePrefix: options.routesDir
	});
}
/**
* Server data modules that can own a separately wired route loader.
*
* These hints stay on the dev-server side: unlike the per-route table above,
* the generated browser entry has no use for data-module filenames. The HMR
* importer walk does, though — a shared module can be client-reachable through
* a component and server-reachable through `route(..., { loader })`, so it
* cannot rely on the server-only full-reload fallback.
*/
function createServerLoaderHintsForHotUpdates(options, root = process.cwd()) {
	const hints = createRouteLoaderHints(resolve(root, options.serverDir.slice(1)), { rootRelativePrefix: options.serverDir });
	return Object.fromEntries(Object.entries(hints).filter((entry) => entry[1] === true));
}
function createPrachtRegistryModuleSource(options = {}) {
	const resolved = resolveOptions(options);
	const apiGlobs = [`${resolved.apiDir}/**/*.{ts,js,tsx,jsx}`, `!${resolved.apiDir}/**/*.d.ts`];
	const isPagesMode = !!resolved.pagesDir;
	const bareRouteExtensions = [...withAdditionalExtensions(LEGACY_BARE_ROUTE_EXTENSIONS, resolved.additionalExtensions)];
	const routeGlob = isPagesMode ? `${resolved.pagesDir}/**/*.{ts,tsx,js,jsx,md,mdx}` : `${resolved.routesDir}/**/*.{ts,tsx,js,jsx,md,mdx}`;
	const additionalRouteGlob = `${isPagesMode ? resolved.pagesDir : resolved.routesDir}/**/*.${extensionGlob(bareRouteExtensions)}`;
	const shellGlob = isPagesMode ? `${resolved.pagesDir}/**/_app.{ts,tsx,js,jsx}` : `${resolved.shellsDir}/**/*.{ts,tsx,js,jsx,md,mdx}`;
	const additionalShellGlob = isPagesMode ? `${resolved.pagesDir}/**/_app.${extensionGlob(bareRouteExtensions)}` : `${resolved.shellsDir}/**/*.${extensionGlob(bareRouteExtensions)}`;
	return [
		`export const routeModules = {`,
		`  ...import.meta.glob(${JSON.stringify(routeGlob)}),`,
		`  ...import.meta.glob(${JSON.stringify(additionalRouteGlob)}),`,
		`};`,
		`export const shellModules = {`,
		`  ...import.meta.glob(${JSON.stringify(shellGlob)}),`,
		`  ...import.meta.glob(${JSON.stringify(additionalShellGlob)}),`,
		`};`,
		`export const middlewareModules = import.meta.glob(${JSON.stringify(`${resolved.middlewareDir}/**/*.{ts,tsx,js,jsx}`)});`,
		`export const apiModules = import.meta.glob(${JSON.stringify(apiGlobs)});`,
		`export const dataModules = import.meta.glob(${JSON.stringify(`${resolved.serverDir}/**/*.{ts,js,tsx,jsx}`)});`,
		`export const capabilityModules = import.meta.glob(${JSON.stringify(`${resolved.capabilitiesDir}/**/*.{ts,js,tsx,jsx}`)});`,
		"",
		"export const registry = {",
		"  routeModules,",
		"  shellModules,",
		"  middlewareModules,",
		"  apiModules,",
		"  dataModules,",
		"  capabilityModules,",
		"};"
	].join("\n");
}
const pagesAppSourceCache = /* @__PURE__ */ new Map();
function clearPagesAppSourceCache() {
	pagesAppSourceCache.clear();
}
function generatePagesAppInlineSource(options, root = process.cwd()) {
	const absPagesDir = resolve(root, options.pagesDir.slice(1));
	const cacheKey = JSON.stringify({
		additionalExtensions: options.additionalExtensions,
		absPagesDir,
		pagesDefaultRender: options.pagesDefaultRender,
		pagesDirPrefix: options.pagesDir
	});
	const cached = pagesAppSourceCache.get(cacheKey);
	if (cached) return cached;
	const source = generatePagesManifestSource(scanPagesDirectory(absPagesDir, options.additionalExtensions), {
		additionalExtensions: options.additionalExtensions,
		pagesDir: absPagesDir,
		pagesDefaultRender: options.pagesDefaultRender,
		pagesDirPrefix: options.pagesDir
	});
	pagesAppSourceCache.set(cacheKey, source);
	return source;
}
function createAgentTrafficBuffer(limit = 200) {
	const capacity = Math.max(1, Math.floor(limit));
	const events = [];
	let recorded = 0;
	return {
		record(event) {
			recorded += 1;
			events.push({
				at: Date.now(),
				capability: event.capability,
				effect: event.effect,
				transport: event.transport,
				via: event.via,
				outcome: event.outcome,
				status: event.status,
				durationMs: event.durationMs,
				agent: event.agent ? {
					agentDomain: event.agent.agentDomain,
					keyId: event.agent.keyId
				} : null
			});
			while (events.length > capacity) events.shift();
		},
		snapshot() {
			return {
				limit: capacity,
				recorded,
				events: [...events].reverse()
			};
		}
	};
}
//#endregion
//#region src/plugin-dev-ssr.ts
const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
const DEFAULT_MAX_BODY_SIZE = 1024 * 1024;
const CSS_MODULE_URL_RE = /\.(?:css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
const DEVTOOLS_JSON_PATH = "/_pracht.json";
const LLMS_TXT_PATH = "/llms.txt";
function isEventStreamContentType(contentType) {
	return contentType.split(";", 1)[0]?.trim().toLowerCase() === "text/event-stream";
}
/**
* Adapter-owned dev servers can route every browser request through their
* platform runtime before Vite's transform middleware gets a chance to serve
* Pracht's stable virtual client entries. Serve those two entries at their
* public, base-prefixed URLs while leaving every other request to the adapter.
*/
function createOwnedDevEntryMiddleware(server) {
	const base = server.config.base || "/";
	return async (req, res, next) => {
		const method = (req.method ?? "GET").toUpperCase();
		if (method !== "GET" && method !== "HEAD") return next();
		const requestUrl = new URL(req.url ?? "/", "http://localhost");
		const pathname = base === "/" ? requestUrl.pathname : requestUrl.pathname.startsWith(base) ? `/${requestUrl.pathname.slice(base.length)}` : null;
		if (pathname !== "/@pracht/client.js" && pathname !== "/@pracht/islands.js") return next();
		try {
			const result = await server.transformRequest(`${pathname}${requestUrl.search}`);
			if (!result) return next();
			if (result.etag && req.headers["if-none-match"] === result.etag) {
				res.statusCode = 304;
				res.end();
				return;
			}
			res.statusCode = 200;
			res.setHeader("content-type", "text/javascript");
			res.setHeader("cache-control", "no-cache");
			if (result.etag) res.setHeader("etag", result.etag);
			for (const [name, value] of Object.entries(server.config.server.headers ?? {})) if (value !== void 0) res.setHeader(name, value);
			res.end(method === "HEAD" ? void 0 : result.code);
		} catch (error) {
			next(error);
		}
	};
}
function createDevSSRMiddleware(server, options = {}) {
	const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;
	const devBase = server.config.base || "/";
	const withDevBase = (path) => devBase === "/" || !path.startsWith("/") ? path : `${devBase}${path.slice(1)}`;
	let warnedDevtoolsCollision = false;
	let warnedLlmsTxtCollision = false;
	const agentTraffic = createAgentTrafficBuffer();
	if (options.llmsTxt && typeof server.config.publicDir === "string") {
		if (existsSync(join(server.config.publicDir, "llms.txt"))) server.config.logger.warn("[pracht] Both public/llms.txt and the pracht({ llmsTxt }) option are present. Dev serves the static public/llms.txt, but \"pracht build\" overwrites it with the generated content. Remove one to avoid a dev/production mismatch.");
	}
	return async (req, res, next) => {
		const url = req.url ?? "/";
		const requestUrl = new URL(url, "http://localhost");
		try {
			const [framework, serverMod] = await Promise.all([server.ssrLoadModule("@pracht/core/server"), server.ssrLoadModule(PRACHT_SERVER_MODULE_ID)]);
			const routeMatchers = {
				app: serverMod.resolvedApp,
				apiRoutes: serverMod.apiRoutes,
				matchApiRoute: framework.matchApiRoute,
				matchAppRoute: framework.matchAppRoute
			};
			if (requestUrl.pathname === "/_pracht" || requestUrl.pathname === "/_pracht.json") {
				if (!warnedDevtoolsCollision && matchesResolvedRoute(requestUrl.pathname, routeMatchers)) {
					warnedDevtoolsCollision = true;
					server.config.logger.warn(`[pracht] An app route matches ${requestUrl.pathname}, which is reserved for the pracht devtools page in dev. The devtools page wins during development; the app route is only served in production builds.`);
				}
				await serveDevtools(server, res, {
					agentTraffic,
					apiRoutes: serverMod.apiRoutes ?? [],
					app: serverMod.resolvedApp,
					base: devBase,
					url,
					wantsJson: requestUrl.pathname === DEVTOOLS_JSON_PATH
				});
				return;
			}
			if (options.llmsTxt && requestUrl.pathname === "/llms.txt" && BODYLESS_METHODS.has((req.method ?? "GET").toUpperCase()) && typeof serverMod.generateLlmsTxt === "function") {
				if (!warnedLlmsTxtCollision && matchesResolvedRoute("/llms.txt", routeMatchers)) {
					warnedLlmsTxtCollision = true;
					server.config.logger.warn(`[pracht] An app route matches ${LLMS_TXT_PATH}, which is reserved by the pracht({ llmsTxt }) option. The generated llms.txt wins; disable the option to serve the app route instead.`);
				}
				const llmsTxt = await serverMod.generateLlmsTxt();
				res.statusCode = 200;
				res.setHeader("content-type", "text/plain; charset=utf-8");
				applyDefaultSecurityHeaders(new Headers()).forEach((value, key) => {
					res.setHeader(key, value);
				});
				res.end(llmsTxt);
				return;
			}
			if (shouldBypassDevSSR(requestUrl, req, routeMatchers)) return next();
			if (isDevNotFoundRequest(requestUrl, req, routeMatchers)) return serveDevNotFound(server, res, next, url, requestUrl.pathname, routeMatchers, devBase);
			let webRequest;
			try {
				webRequest = await nodeToWebRequest(req, maxBodySize, devBase);
			} catch (err) {
				if (err instanceof Error && err.message === "Request body too large") {
					res.statusCode = 413;
					res.end("Payload Too Large");
					return;
				}
				throw err;
			}
			const timings = {};
			let routeError;
			let capturedRouteError = false;
			let routeErrorContext;
			const response = await framework.handlePrachtRequest({
				app: serverMod.resolvedApp,
				registry: serverMod.registry,
				request: webRequest,
				debugErrors: true,
				onRouteError: (error, _requestPath, context) => {
					capturedRouteError = true;
					routeError = error;
					routeErrorContext = context;
				},
				clientEntryUrl: withDevBase(CLIENT_BROWSER_PATH),
				islandsEntryUrl: withDevBase(ISLANDS_CLIENT_BROWSER_PATH),
				islandsBootstrapRequired: serverMod.islandsBootstrapRequired === true,
				apiRoutes: serverMod.apiRoutes,
				timings,
				onCapabilityAudit: agentTraffic.record
			});
			const responseContentType = response.headers.get("content-type") ?? "";
			if (response.status === 404 && !responseContentType.includes("application/json") && !routeMatchers.app?.notFound) return next();
			const contentType = response.headers.get("content-type") ?? "";
			if (response.body && isEventStreamContentType(contentType)) {
				res.statusCode = response.status;
				response.headers.forEach((value, key) => {
					res.setHeader(key, value);
				});
				const source = Readable.fromWeb(response.body);
				if (res.destroyed || res.writableEnded) {
					source.destroy();
					return;
				}
				res.on("close", () => {
					if (!res.writableFinished) source.destroy();
				});
				source.on("error", () => {
					res.destroy();
				});
				source.pipe(res);
				return;
			}
			if (shouldRenderDevErrorOverlay({
				capturedRouteError,
				contentType,
				exposeServerErrors: shouldExposeDevServerErrors(),
				hasErrorBoundary: routeErrorContext?.errorBoundary != null,
				status: response.status
			})) {
				const serverTiming = framework.formatServerTimingHeader(timings);
				await respondWithErrorOverlay(server, res, url, routeError, routeErrorContext, devBase, response.status, serverTiming);
				return;
			}
			if (shouldStreamDevHtmlResponse(framework, response, contentType)) {
				await streamDevHtmlResponse(server, res, url, response, devBase, framework.formatServerTimingHeader(timings));
				return;
			}
			let body = await response.text();
			if (contentType.includes("text/html")) body = await transformDevHtml(server, url, body, devBase);
			res.statusCode = response.status;
			response.headers.forEach((value, key) => {
				res.setHeader(key, value);
			});
			const serverTiming = framework.formatServerTimingHeader(timings);
			if (serverTiming) res.setHeader("Server-Timing", serverTiming);
			res.end(body);
		} catch (error) {
			await handleDevError(server, req, res, next, url, error, devBase);
		}
	};
}
function shouldStreamDevHtmlResponse(framework, response, contentType) {
	return response.body !== null && contentType.includes("text/html") && framework.isStreamingHtmlResponse?.(response) === true;
}
async function streamDevHtmlResponse(server, res, url, response, base, serverTiming) {
	const reader = response.body.getReader();
	let committed = false;
	const cancel = () => {
		if (!res.writableFinished) reader.cancel().catch(() => void 0);
	};
	res.on("close", cancel);
	try {
		const first = await reader.read();
		const transformed = await transformStreamingDevHtmlPrefix(server, url, first.done ? "" : new TextDecoder().decode(first.value), base);
		res.statusCode = response.status;
		response.headers.forEach((value, key) => {
			res.setHeader(key, value);
		});
		res.removeHeader("content-length");
		if (serverTiming) res.setHeader("Server-Timing", serverTiming);
		committed = true;
		if (transformed.prefix) await writeDevResponseChunk(res, transformed.prefix);
		let bodyEndInjected = transformed.beforeBodyClose === "";
		const decoder = new TextDecoder();
		while (!first.done) {
			const next = await reader.read();
			if (next.done) break;
			let chunk = next.value;
			if (!bodyEndInjected) {
				const injection = injectStreamingBodyEnd(decoder.decode(next.value), transformed.beforeBodyClose);
				chunk = injection.html;
				bodyEndInjected = injection.injected;
			}
			await writeDevResponseChunk(res, chunk);
		}
		res.end();
	} catch (error) {
		if (committed || res.headersSent) {
			res.destroy(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		throw error;
	} finally {
		res.removeListener("close", cancel);
		reader.releaseLock();
	}
}
const STREAM_PREFIX_END_MARKER = "<template data-pracht-stream-prefix-end=\"\"></template>";
const STREAM_BODY_END_MARKER = "<template data-pracht-stream-body-end=\"\"></template>";
/**
* Run Vite's HTML hooks against a syntactically complete document, then split
* their output back into the prefix that can be committed now and tags that
* belong immediately before `</body>` once the stream finishes.
*/
async function transformStreamingDevHtmlPrefix(server, url, prefix, base) {
	const transformed = await transformDevHtml(server, url, `${prefix}${STREAM_PREFIX_END_MARKER}</div>${STREAM_BODY_END_MARKER}</body></html>`, base);
	const prefixEnd = transformed.indexOf(STREAM_PREFIX_END_MARKER);
	const bodyMarker = transformed.indexOf(STREAM_BODY_END_MARKER, prefixEnd);
	const bodyClose = transformed.indexOf("</body>", bodyMarker);
	if (prefixEnd < 0 || bodyMarker < 0 || bodyClose < 0) throw new Error("A Vite transform removed Pracht's streaming HTML markers; the document cannot be streamed safely in development.");
	return {
		prefix: transformed.slice(0, prefixEnd),
		beforeBodyClose: transformed.slice(bodyMarker + 52, bodyClose)
	};
}
/** Insert deferred Vite `body` tags into the runtime-owned closing chunk. */
function injectStreamingBodyEnd(html, beforeBodyClose) {
	const bodyClose = html.indexOf("</body>");
	if (bodyClose < 0) return {
		html,
		injected: false
	};
	return {
		html: `${html.slice(0, bodyClose)}${beforeBodyClose}${html.slice(bodyClose)}`,
		injected: true
	};
}
async function writeDevResponseChunk(res, chunk) {
	if (res.destroyed || res.writableEnded || res.write(chunk)) return;
	await new Promise((resolve, reject) => {
		const cleanup = () => {
			res.removeListener("close", onClose);
			res.removeListener("drain", onDrain);
			res.removeListener("error", onError);
		};
		const onClose = () => {
			cleanup();
			resolve();
		};
		const onDrain = () => {
			cleanup();
			resolve();
		};
		const onError = (error) => {
			cleanup();
			reject(error);
		};
		res.once("close", onClose);
		res.once("drain", onDrain);
		res.once("error", onError);
	});
}
/**
* Vite's HTML transform adds `config.base` to root-absolute asset attributes.
* Pracht's runtime has already added it to URLs produced by `withBase()` — the
* client entry, route-state preloads, image endpoints, and user-authored asset
* URLs — while Vite-owned or module-graph URLs still need the transform. Hide
* the already-based strings while the hooks run, then restore them afterward,
* so each producer applies the deploy base exactly once.
*/
async function transformDevHtml(server, url, html, base) {
	if (base === "/") return server.transformIndexHtml(url, html);
	const assetUrls = protectRootAbsoluteAssetAttributes(html);
	let placeholder = "https://pracht.invalid/__PRACHT_DEV_BASE_PLACEHOLDER__/";
	while (assetUrls.html.includes(placeholder)) placeholder += "_";
	const protectedHtml = assetUrls.html.replaceAll(base, placeholder);
	const transformedHtml = await server.transformIndexHtml(url, protectedHtml);
	return assetUrls.restore(transformedHtml.replaceAll(placeholder, base));
}
const HTML_ASSET_URL_ATTRIBUTE_RE = /(\s(?:src|href|xlink:href|data|srcset|imagesrcset|poster|content)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
/**
* Runtime-rendered root-absolute asset URLs have already reached their final
* public meaning: raw `/logo.svg` deliberately stays at the origin root,
* while `withBase("/logo.svg")` is already under the deploy base. Vite's dev
* HTML pass prefixes both, unlike production SSR, so hide complete attribute
* values behind inert external URLs until that pass finishes.
*/
function protectRootAbsoluteAssetAttributes(html) {
	let markerPrefix = "https://pracht.invalid/__PRACHT_DEV_ASSET_PLACEHOLDER__/";
	while (html.includes(markerPrefix)) markerPrefix += "_";
	const replacements = [];
	return {
		html: html.replace(HTML_ASSET_URL_ATTRIBUTE_RE, (match, prefix, doubleQuoted, singleQuoted, unquoted) => {
			const value = doubleQuoted ?? singleQuoted ?? unquoted ?? "";
			if (!(/(?:srcset)\s*=\s*$/i.test(prefix) ? /(?:^|,)\s*\/(?!\/)/.test(value) : /^\s*\/(?!\/)/.test(value))) return match;
			const marker = `${markerPrefix}${replacements.length}`;
			replacements.push({
				marker,
				value
			});
			if (doubleQuoted !== void 0) return `${prefix}"${marker}"`;
			if (singleQuoted !== void 0) return `${prefix}'${marker}'`;
			return `${prefix}${marker}`;
		}),
		restore(transformedHtml) {
			let restoredHtml = transformedHtml;
			for (const { marker, value } of replacements) restoredHtml = restoredHtml.replaceAll(marker, value);
			return restoredHtml;
		}
	};
}
/**
* Build the development equivalent of the production CSS manifest for the
* current route. Vite turns CSS imports into client-side style injection by
* default; resolving the same imports through the active server environment
* graphs lets pracht put real stylesheet links in the initial document and
* avoid a first-paint FOUC.
*/
async function createDevCssManifest(server, options) {
	const route = Object.hasOwn(options, "route") ? options.route ?? void 0 : options.pathname === null ? void 0 : options.matchAppRoute(options.app, options.pathname)?.route ?? options.app.notFound;
	if (!route) return {};
	const manifest = {};
	const modules = [...route.shellFile ? [{
		file: route.shellFile,
		registry: options.registry.shellModules
	}] : [], {
		file: route.file,
		registry: options.registry.routeModules
	}];
	const results = await Promise.all(modules.map(async ({ file, registry }) => {
		if (!registry) return {
			file,
			urls: []
		};
		const moduleKey = findRegistryModuleKey(registry, file);
		if (!moduleKey) return {
			file,
			urls: []
		};
		const entries = await Promise.all(Object.values(server.environments).map((environment) => environment.moduleGraph.getModuleByUrl(moduleKey)));
		return {
			file,
			urls: [...new Set(entries.flatMap((entry) => collectDevCssUrls(entry)))]
		};
	}));
	for (const { file, urls } of results) if (urls.length > 0) manifest[file] = urls;
	return manifest;
}
function findRegistryModuleKey(modules, file) {
	if (!modules) return void 0;
	if (file in modules) return file;
	const suffix = `/${file.split("?")[0].replace(/\\/g, "/").replace(/^\.?\//, "")}`;
	return Object.keys(modules).find((key) => key.split("?")[0].replace(/\\/g, "/").endsWith(suffix));
}
function collectDevCssUrls(entry) {
	if (!entry) return [];
	const urls = /* @__PURE__ */ new Set();
	const visited = /* @__PURE__ */ new Set();
	const pending = [entry];
	while (pending.length > 0) {
		const module = pending.pop();
		if (visited.has(module)) continue;
		visited.add(module);
		if ((module.type === "css" || CSS_MODULE_URL_RE.test(module.url)) && !/[?&](?:inline|raw|url)(?:[=&]|$)/.test(module.url)) urls.add(module.url);
		pending.push(...[...module.importedModules].reverse());
	}
	return [...urls];
}
function injectDevCssLinks(html, manifest, base = "/") {
	if (!html.includes("</head>")) return html;
	const tags = [...new Set(Object.values(manifest).flat().map((url) => base === "/" || !url.startsWith("/") ? url : `${base}${url.slice(1)}`))].map((url) => escapeHtmlAttribute(url)).filter((escapedUrl) => !html.includes(`href="${escapedUrl}"`)).map((escapedUrl) => `<link rel="stylesheet" href="${escapedUrl}">`);
	if (tags.length === 0) return html;
	return html.replace("</head>", `    ${tags.join("\n    ")}\n  </head>`);
}
async function injectDevCssForPath(server, path, html, options = {}) {
	return injectDevCssLinks(html, await createDevCssManifest(server, await resolveDevCssContextForPath(server, path, options)), server.config.base || "/");
}
async function resolveDevCssContextForPath(server, path, options = {}) {
	const [framework, serverMod] = await Promise.all([server.ssrLoadModule("@pracht/core/server"), server.ssrLoadModule(PRACHT_DEV_MODULE_ID)]);
	const publicPathname = new URL(path, "http://localhost").pathname;
	const pathname = options.basePathRetained ? framework.stripBase(publicPathname) : publicPathname;
	const route = pathname === null ? void 0 : framework.matchAppRoute(serverMod.resolvedApp, pathname)?.route ?? serverMod.resolvedApp.notFound;
	return {
		app: serverMod.resolvedApp,
		matchAppRoute: framework.matchAppRoute,
		pathname,
		registry: serverMod.registry,
		route: route ?? null,
		streaming: route?.streaming === true
	};
}
/**
* Adapter-owned dev servers (for example Cloudflare's worker runtime) bypass
* Vite's HTML transform hooks. Install this before the adapter middleware so
* document responses still receive the same parser-blocking stylesheet links.
*/
function createDevCssInjectionMiddleware(server) {
	let warned = false;
	return (req, res, next) => {
		const method = (req.method ?? "GET").toUpperCase();
		const accept = readRequestHeader(req.headers.accept).toLowerCase();
		if (method !== "GET" || !accept.includes("text/html")) {
			next();
			return;
		}
		const contextPromise = resolveDevCssContextForPath(server, req.url ?? "/", { basePathRetained: true }).catch((error) => {
			if (!warned) {
				warned = true;
				server.config.logger.warn(`[pracht] Could not discover development stylesheets: ${error instanceof Error ? error.message : String(error)}`);
			}
			return null;
		});
		const bufferedWrites = [];
		const originalEnd = res.end.bind(res);
		const originalWrite = res.write.bind(res);
		const originalWriteHead = res.writeHead.bind(res);
		let passThrough = false;
		let streamingFlush;
		const flushStreamingPrefix = () => {
			if (streamingFlush) return streamingFlush;
			streamingFlush = (async () => {
				const context = await contextPromise;
				const contentType = String(res.getHeader("content-type") ?? "");
				if (!context?.streaming || !contentType.includes("text/html")) return false;
				let manifest = {};
				try {
					manifest = await createDevCssManifest(server, context);
				} catch {}
				const html = injectDevCssLinks(Buffer.concat(bufferedWrites.map(({ chunk }) => chunk)).toString("utf-8"), manifest, server.config.base || "/");
				const callbacks = bufferedWrites.flatMap(({ callback }) => callback ? [callback] : []);
				bufferedWrites.length = 0;
				passThrough = true;
				originalWrite(html, () => {
					for (const callback of callbacks) callback();
				});
				return true;
			})().catch(() => false);
			return streamingFlush;
		};
		res.writeHead = ((statusCode, ...args) => {
			res.removeHeader("content-length");
			return Reflect.apply(originalWriteHead, res, [statusCode, ...args.map(stripContentLengthHeader)]);
		});
		res.write = ((chunk, encodingOrCallback, callback) => {
			const done = typeof encodingOrCallback === "function" ? encodingOrCallback : typeof callback === "function" ? callback : void 0;
			if (passThrough) return Reflect.apply(originalWrite, res, [
				chunk,
				encodingOrCallback,
				callback
			]);
			bufferedWrites.push({
				chunk: toBuffer(chunk, encodingOrCallback),
				callback: done
			});
			flushStreamingPrefix();
			return true;
		});
		res.end = ((chunk, encodingOrCallback, callback) => {
			const done = typeof encodingOrCallback === "function" ? encodingOrCallback : typeof callback === "function" ? callback : void 0;
			if (passThrough) return Reflect.apply(originalEnd, res, [
				chunk,
				encodingOrCallback,
				callback
			]);
			if (chunk != null) bufferedWrites.push({ chunk: toBuffer(chunk, encodingOrCallback) });
			(async () => {
				if (await flushStreamingPrefix()) {
					originalEnd(void 0, done);
					return;
				}
				const body = Buffer.concat(bufferedWrites.map(({ chunk: value }) => value));
				const callbacks = bufferedWrites.flatMap(({ callback }) => callback ? [callback] : []);
				bufferedWrites.length = 0;
				if (!String(res.getHeader("content-type") ?? "").includes("text/html")) {
					originalEnd(body, () => {
						for (const callback of callbacks) callback();
						done?.();
					});
					return;
				}
				try {
					const context = await contextPromise;
					const manifest = context ? await createDevCssManifest(server, context) : null;
					originalEnd(manifest ? injectDevCssLinks(body.toString("utf-8"), manifest, server.config.base || "/") : body.toString("utf-8"), () => {
						for (const callback of callbacks) callback();
						done?.();
					});
				} catch {
					originalEnd(body, () => {
						for (const callback of callbacks) callback();
						done?.();
					});
				}
			})();
			return res;
		});
		next();
	};
}
function toBuffer(chunk, encoding) {
	if (Buffer.isBuffer(chunk)) return chunk;
	if (chunk instanceof Uint8Array) return Buffer.from(chunk);
	return Buffer.from(String(chunk), typeof encoding === "string" ? encoding : void 0);
}
function stripContentLengthHeader(value) {
	if (Array.isArray(value)) {
		const headers = [];
		for (let index = 0; index < value.length; index += 2) if (String(value[index]).toLowerCase() !== "content-length") headers.push(value[index], value[index + 1]);
		return headers;
	}
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([name]) => name.toLowerCase() !== "content-length"));
	return value;
}
function escapeHtmlAttribute(value) {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
/**
* Serve the dev-only `/_pracht` devtools page (or `/_pracht.json`) built from
* the same resolved app graph that `pracht inspect` reports.
*/
async function serveDevtools(server, res, options) {
	const devtools = await server.ssrLoadModule("@pracht/core/devtools");
	const serverModule = await server.ssrLoadModule(PRACHT_SERVER_MODULE_ID);
	const capabilityModules = serverModule.registry?.capabilityModules;
	const middlewareModules = serverModule.registry?.middlewareModules;
	const graph = await devtools.buildAppGraph({
		apiRoutes: options.apiRoutes,
		app: options.app,
		loadModule: async (file) => {
			return await resolveRegistryModule(capabilityModules, file) ?? server.ssrLoadModule(file);
		},
		loadSetupModule: async (file) => {
			return await resolveRegistryModule(middlewareModules, file) ?? server.ssrLoadModule(file);
		},
		verifyMcpTokenVerifier: async () => {
			const auth = options.app.agents?.mcp?.auth;
			if (!auth) return;
			await (await server.ssrLoadModule("@pracht/core/server")).loadMcpTokenVerifier(auth, serverModule.registry ?? {});
		},
		readSource: (file) => readFileSync(resolve(server.config.root, `.${file}`), "utf-8")
	});
	const agentTraffic = options.agentTraffic.snapshot();
	if (options.wantsJson) {
		res.statusCode = 200;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({
			...graph,
			agentTraffic
		}, null, 2));
		return;
	}
	let html = devtools.buildDevtoolsHtml(graph, {
		agentTraffic,
		base: options.base
	});
	html = await server.transformIndexHtml(options.url, html);
	res.statusCode = 200;
	res.setHeader("content-type", "text/html; charset=utf-8");
	res.end(html);
}
/**
* True when a dev response should be replaced by the error overlay.
*
* The runtime only falls back to `text/plain` for a page render when neither
* the route nor its shell declares an ErrorBoundary. When one does, the
* response is the app's own error UI (`text/html`) and dev must leave it
* alone. Route-state and capability failures are JSON and belong to the
* client router, not to a human reading a document.
*/
function shouldRenderDevErrorOverlay(options) {
	return options.capturedRouteError && options.exposeServerErrors && !options.hasErrorBoundary && options.status >= 500 && options.contentType.toLowerCase().startsWith("text/plain");
}
/**
* The dev middleware passes `debugErrors: true` unconditionally, but the
* runtime refuses to honor it when `NODE_ENV === "production"` (see
* `shouldExposeServerErrors` in @pracht/core) — a dev server started inside a
* container that exports `NODE_ENV=production` must not answer with internals.
* The overlay is built from the raw error rather than from the runtime's
* already-redacted body, so it has to repeat that check.
*/
function shouldExposeDevServerErrors() {
	return (typeof process !== "undefined" ? process.env?.NODE_ENV : void 0) !== "production";
}
/**
* Render a failed page render as the dev error overlay.
*
* `handlePrachtRequest` answers a render/loader/middleware failure with the
* runtime's plain-text fallback whenever no ErrorBoundary claims it. In a
* production adapter that is correct — a browser is not the audience. In dev
* the browser *is* the audience, and the fallback is at its worst exactly when
* it matters most: a compiler diagnostic arrives colourized for a terminal, so
* `text/plain` renders every escape sequence literally.
*/
async function respondWithErrorOverlay(server, res, url, error, context, base, status, serverTiming) {
	if (error instanceof Error) server.ssrFixStacktrace(error);
	const { buildErrorOverlayHtml } = await server.ssrLoadModule("@pracht/core/error-overlay");
	let html = buildErrorOverlayHtml({
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : void 0,
		routeId: context?.routeId,
		file: context?.routeFile,
		loaderFile: context?.loaderFile,
		shellFile: context?.shellFile,
		phase: context?.phase,
		root: server.config.root,
		base
	});
	html = await server.transformIndexHtml(url, html);
	res.statusCode = status;
	res.setHeader("content-type", "text/html; charset=utf-8");
	applyDefaultSecurityHeaders(new Headers()).forEach((value, key) => {
		res.setHeader(key, value);
	});
	if (serverTiming) res.setHeader("Server-Timing", serverTiming);
	res.end(html);
}
async function handleDevError(server, req, res, next, url, error, base) {
	if (error instanceof Error) server.ssrFixStacktrace(error);
	if (req.headers["x-pracht-route-state-request"] === "1") {
		res.statusCode = 500;
		res.setHeader("content-type", "application/json; charset=utf-8");
		res.end(JSON.stringify({ error: {
			message: error instanceof Error ? error.message : String(error),
			name: error instanceof Error ? error.name : "Error",
			status: 500
		} }));
		return;
	}
	try {
		const { buildErrorOverlayHtml } = await server.ssrLoadModule("@pracht/core/error-overlay");
		let html = buildErrorOverlayHtml({
			message: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : void 0,
			root: server.config.root,
			base
		});
		html = await server.transformIndexHtml(url, html);
		res.statusCode = 500;
		res.setHeader("content-type", "text/html; charset=utf-8");
		res.end(html);
	} catch {
		next(error);
	}
}
/**
* True when a GET/HEAD document request matches no page route and no API
* route — the dev middleware then serves the rich dev-only 404 page instead
* of falling through to Vite. Route-state (JSON) requests and non-document
* fetches keep their existing 404 behavior.
*
* Apps that declare a `notFound` page own their 404s: dev renders that page
* (exactly as production does) rather than the framework's route table.
*/
function isDevNotFoundRequest(requestUrl, req, options = {}) {
	const url = typeof requestUrl === "string" ? new URL(requestUrl, "http://localhost") : requestUrl;
	if (options.app?.notFound) return false;
	if (isRouteStateRequest(url, req)) return false;
	const method = (req.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return false;
	const accept = readRequestHeader(req.headers.accept).toLowerCase();
	if (!accept.includes("text/html") && !accept.includes("application/xhtml+xml")) return false;
	return !matchesResolvedRoute(url.pathname, options);
}
async function serveDevNotFound(server, res, next, url, pathname, options, base) {
	try {
		const { buildDevNotFoundHtml } = await server.ssrLoadModule("@pracht/core/dev-404");
		let html = buildDevNotFoundHtml({
			apiRoutes: options.apiRoutes.map((route) => ({ path: route.path })),
			base,
			requestedPath: pathname,
			routes: options.app.routes.map((route) => ({
				path: route.path,
				render: route.render ?? null
			}))
		});
		html = await server.transformIndexHtml(url, html);
		res.statusCode = 404;
		res.setHeader("content-type", "text/html; charset=utf-8");
		res.end(html);
	} catch {
		next();
	}
}
function shouldBypassDevSSR(requestUrl, req, options = {}) {
	const url = typeof requestUrl === "string" ? new URL(requestUrl, "http://localhost") : requestUrl;
	const pathname = url.pathname;
	if (isReservedDevPath(pathname)) return true;
	if (isRouteStateRequest(url, req)) return false;
	if (pathname === "/api" || pathname.startsWith("/api/")) return false;
	const method = (req.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return false;
	const fetchDest = readRequestHeader(req.headers["sec-fetch-dest"]).toLowerCase();
	if (matchesResolvedRoute(pathname, options) && !NON_DOCUMENT_FETCH_DESTINATIONS.has(fetchDest)) return false;
	if (NON_DOCUMENT_FETCH_DESTINATIONS.has(fetchDest)) return true;
	const accept = readRequestHeader(req.headers.accept).toLowerCase();
	if (accept.includes("text/html") || accept.includes("application/xhtml+xml")) return false;
	return hasKnownAssetExtension(pathname);
}
function matchesResolvedRoute(pathname, options) {
	if (options.app && options.matchAppRoute && options.matchAppRoute(options.app, pathname)) return true;
	if (options.apiRoutes?.length && options.matchApiRoute && options.matchApiRoute(options.apiRoutes, pathname)) return true;
	return false;
}
function isRouteStateRequest(url, req) {
	return req.headers["x-pracht-route-state-request"] === "1" || url.searchParams.get("_data") === "1";
}
function readRequestHeader(value) {
	if (Array.isArray(value)) return value.join(", ");
	return value ?? "";
}
function hasKnownAssetExtension(pathname) {
	const fileName = pathname.split("/").pop() ?? "";
	const extensionIndex = fileName.lastIndexOf(".");
	if (extensionIndex <= 0) return false;
	const extension = fileName.slice(extensionIndex).toLowerCase();
	return DEV_ASSET_EXTENSIONS.has(extension);
}
function isReservedDevPath(pathname) {
	return pathname === "/@pracht/client.js" || pathname === "/@pracht/islands.js" || pathname === "/@vite/client" || pathname === "/@react-refresh" || pathname.startsWith("/@vite/") || pathname.startsWith("/@id/") || pathname.startsWith("/@fs/") || pathname.startsWith("/__vite_");
}
const NON_DOCUMENT_FETCH_DESTINATIONS = new Set([
	"audio",
	"embed",
	"font",
	"image",
	"manifest",
	"object",
	"paintworklet",
	"report",
	"script",
	"serviceworker",
	"sharedworker",
	"style",
	"track",
	"video",
	"worker"
]);
const DEV_ASSET_EXTENSIONS = new Set([
	".avif",
	".bmp",
	".cjs",
	".css",
	".gif",
	".ico",
	".jpeg",
	".jpg",
	".js",
	".json",
	".map",
	".markdown",
	".md",
	".mjs",
	".pdf",
	".png",
	".svg",
	".txt",
	".wasm",
	".webmanifest",
	".webp",
	".woff",
	".woff2",
	".xml"
]);
async function nodeToWebRequest(req, maxBodySize, base = "/") {
	const protocol = "http";
	const host = req.headers.host ?? "localhost";
	const path = req.url ?? "/";
	const url = new URL(base === "/" || !path.startsWith("/") ? path : `${base}${path.slice(1)}`, `${protocol}://${host}`);
	const method = req.method ?? "GET";
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value === void 0) continue;
		if (Array.isArray(value)) for (const v of value) headers.append(key, v);
		else headers.set(key, value);
	}
	const init = {
		method,
		headers
	};
	if (!BODYLESS_METHODS.has(method.toUpperCase())) {
		const chunks = [];
		let totalSize = 0;
		for await (const chunk of req) {
			const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
			totalSize += buf.byteLength;
			if (totalSize > maxBodySize) throw new Error("Request body too large");
			chunks.push(buf);
		}
		const body = Buffer.concat(chunks);
		if (body.byteLength > 0) init.body = body;
	}
	return new Request(url, init);
}
//#endregion
//#region src/index.ts
function pracht(options = {}) {
	const resolved = resolveOptions(options);
	const isPagesMode = !!resolved.pagesDir;
	let root = process.cwd();
	let routeFileDirs = [];
	let clientRouteHeadHints = {};
	let clientRouteHeadersHints = {};
	let clientRouteLoaderHints = {};
	let serverRouteLoaderHints = {};
	const routeFileExtensions = withAdditionalExtensions(DEFAULT_ROUTE_EXTENSIONS, resolved.additionalExtensions);
	let capabilityModulePaths = /* @__PURE__ */ new Set();
	if (isPagesMode && options.appFile) console.warn("[pracht] Both `pagesDir` and `appFile` are set. `pagesDir` takes precedence — `appFile` will be ignored.");
	let isBuild = false;
	let base = "/";
	let configuredBase;
	const prachtPlugin = {
		name: "pracht",
		enforce: "pre",
		api: { llmsTxtEnabled: Boolean(resolved.llmsTxt) },
		config(_config, env) {
			const isEdge = resolved.adapter.edge === true;
			const isSSRBuild = env.isSsrBuild;
			const configRoot = _config.root ?? process.cwd();
			const wantsIslandsEntry = env.command === "build" && !isSSRBuild && (existsSync(resolveConfigPath(configRoot, resolved.islandsDir)) || hasWebmcpCapabilities(resolved, configRoot));
			const envDir = _config.envDir ? resolve(configRoot, _config.envDir) : configRoot;
			const publicEnvDefine = JSON.stringify(loadEnv(env.mode, envDir, PUBLIC_ENV_PREFIX));
			const agentSurfaceDefine = env.command === "build" ? String(hasAgentSurface(resolved, configRoot)) : "true";
			const staticTargetDefine = String(env.command === "build" && resolved.adapter.staticTarget === true);
			const clientFeatureDefines = { __PRACHT_CLIENT_PREFETCH__: String(resolved.client.prefetch) };
			const clientChunkConfig = isSSRBuild || !resolved.vendorChunk ? {} : frameworkChunkConfig(_config.build?.rollupOptions?.output);
			if (clientChunkConfig.warning) console.warn(`[pracht] ${clientChunkConfig.warning}`);
			return {
				appType: "custom",
				envPrefix: ["VITE_", PUBLIC_ENV_PREFIX],
				resolve: { dedupe: PREACT_DEDUPE },
				define: {
					__PRACHT_PUBLIC_ENV__: publicEnvDefine,
					__PRACHT_AGENT_SURFACE__: agentSurfaceDefine,
					__PRACHT_STATIC_TARGET__: staticTargetDefine,
					...clientFeatureDefines
				},
				...isSSRBuild ? {} : { build: { rollupOptions: {
					...wantsIslandsEntry ? { input: [PRACHT_ISLANDS_CLIENT_MODULE_ID] } : {},
					...clientChunkConfig.output ? { output: clientChunkConfig.output } : {}
				} } },
				...isEdge && isSSRBuild ? {
					ssr: {
						noExternal: true,
						target: "webworker"
					},
					environments: { ssr: { resolve: {
						conditions: [
							"worker",
							"module",
							"browser",
							"development|production"
						],
						external: ["node:module"]
					} } },
					build: { rollupOptions: { external: [/^cloudflare:/] } }
				} : {},
				...!isEdge && isSSRBuild || env.command === "serve" ? { ssr: { noExternal: [PRACHT_SSR_NO_EXTERNAL] } } : {}
			};
		},
		configResolved(config) {
			assertSafeRootAbsoluteDeployBase(config.base);
			root = config.root;
			isBuild = config.command === "build";
			base = config.base;
			routeFileDirs = computeRouteFileDirs(root, resolved);
			capabilityModulePaths = new Set(resolveCapabilityModulePaths(resolved, root).map(canonicalFilePath));
		},
		resolveId(id, importer, resolveIdOptions) {
			if (isIslandsClientModule(id)) return PRACHT_ISLANDS_CLIENT_MODULE_ID;
			if (isClientModule(id)) return PRACHT_CLIENT_MODULE_ID;
			if (isDevModule(id)) return PRACHT_DEV_MODULE_ID;
			if (isServerModule(id)) return PRACHT_SERVER_MODULE_ID;
			if (isCapabilitiesModule(id)) return PRACHT_CAPABILITIES_MODULE_ID;
			if (isWebmcpModule(id)) return PRACHT_WEBMCP_MODULE_ID;
			if (id === "@pracht/core/env/server" && !resolveIdOptions?.ssr && !resolveIdOptions?.scan) throw new Error(`[pracht] ${JSON.stringify(SERVER_ENV_MODULE_ID)} was imported by ${JSON.stringify(importer ?? "unknown module")} in client code. serverEnv is server-only — read it inside loaders, middleware, or API routes, or use publicEnv (PRACHT_PUBLIC_-prefixed variables) from "@pracht/core" instead.`);
			return null;
		},
		load(id) {
			if (isIslandsClientModule(id)) return createPrachtIslandsClientModuleSource(resolved, { root });
			if (isClientModule(id)) {
				clientRouteHeadHints = createRouteHeadHintsForVirtualModules(resolved, root);
				clientRouteHeadersHints = createRouteHeadersHintsForVirtualModules(resolved, root);
				clientRouteLoaderHints = createRouteLoaderHintsForVirtualModules(resolved, root);
				serverRouteLoaderHints = createServerLoaderHintsForHotUpdates(resolved, root);
				return createPrachtClientModuleSource(resolved, { root });
			}
			if (isDevModule(id)) return createPrachtDevModuleSource(resolved, {
				root,
				base
			});
			if (isServerModule(id)) return createPrachtServerModuleSource(resolved, {
				root,
				isBuild,
				base,
				configuredBase
			});
			if (isCapabilitiesModule(id)) return createPrachtCapabilitiesClientModuleSource(resolved, { root });
			if (isWebmcpModule(id)) return createPrachtWebmcpModuleSource(resolved, { root });
			return null;
		},
		transform(code, id) {
			const appFileAbs = canonicalFilePath(resolveConfigPath(root, resolved.appFile));
			if (canonicalFilePath(id.split("?")[0]) !== appFileAbs) return null;
			const transformed = rewriteManifestCoreImports(code.replace(/\(\)\s*=>\s*import\(\s*(['"])([^'"]+)\1\s*\)/g, "$1$2$1"));
			if (transformed === code) return null;
			return {
				code: transformed,
				map: null
			};
		},
		configureServer(server) {
			if (isPagesMode) watchPagesDirectory(server, resolved, root);
			if (resolved.adapter.ownsDevServer) {
				server.middlewares.use(createOwnedDevEntryMiddleware(server));
				server.middlewares.use(createDevCssInjectionMiddleware(server));
				return;
			}
			return () => {
				server.middlewares.use(createDevSSRMiddleware(server, {
					llmsTxt: !!resolved.llmsTxt,
					maxBodySize: resolved.maxBodySize
				}));
			};
		},
		async transformIndexHtml(html, context) {
			if (isBuild || !context.server || !html.includes("</head>")) return html;
			try {
				return await injectDevCssForPath(context.server, context.path, html);
			} catch {
				return html;
			}
		},
		handleHotUpdate({ file, modules = [], server }) {
			const serverRoot = toPosixPath(server.config.root);
			const normalizedFile = toPosixPath(file);
			const relative = normalizedFile.startsWith(serverRoot) ? normalizedFile.slice(serverRoot.length) : normalizedFile;
			const changesRouteHeadSource = isPagesMode ? relative.startsWith(resolved.pagesDir) : relative.startsWith(resolved.routesDir) || relative.startsWith(resolved.shellsDir);
			const changesRouteLoaderSource = isPagesMode ? relative.startsWith(resolved.pagesDir) : relative.startsWith(resolved.routesDir);
			const previousServerRouteLoaderHints = serverRouteLoaderHints;
			if (!isPagesMode && relative.startsWith(resolved.serverDir)) try {
				serverRouteLoaderHints = createServerLoaderHintsForHotUpdates(resolved, root);
			} catch {}
			const loaderDependencyHints = {
				...clientRouteLoaderHints,
				...previousServerRouteLoaderHints,
				...serverRouteLoaderHints
			};
			const changesRouteHeadDependency = reachesRouteHintedModule(modules, serverRoot, clientRouteHeadHints, { startAtImporters: changesRouteHeadSource });
			const changesRouteHeadersDependency = reachesRouteHintedModule(modules, serverRoot, clientRouteHeadersHints, { startAtImporters: changesRouteHeadSource });
			const changesRouteLoaderDependency = reachesRouteHintedModule(modules, serverRoot, loaderDependencyHints, { startAtImporters: changesRouteLoaderSource });
			let shouldReloadClientEntry = changesRouteHeadDependency || changesRouteHeadersDependency;
			let clientHeadModule;
			if (changesRouteHeadSource || changesRouteHeadDependency || changesRouteHeadersDependency) clientHeadModule = server.moduleGraph.getModuleById(PRACHT_CLIENT_MODULE_ID);
			if (changesRouteHeadSource) {
				const previousHint = clientRouteHeadHints[relative] === true;
				try {
					const nextHints = createRouteHeadHintsForVirtualModules(resolved, root);
					shouldReloadClientEntry ||= previousHint !== (nextHints[relative] === true);
					clientRouteHeadHints = nextHints;
				} catch {
					shouldReloadClientEntry = true;
				}
			} else if (changesRouteHeadDependency && clientHeadModule) server.moduleGraph.invalidateModule(clientHeadModule);
			if (changesRouteHeadSource) {
				const previouslyHadHeaders = clientRouteHeadersHints[relative] === true;
				try {
					const nextHints = createRouteHeadersHintsForVirtualModules(resolved, root);
					shouldReloadClientEntry ||= previouslyHadHeaders || nextHints[relative] === true;
					clientRouteHeadersHints = nextHints;
				} catch {
					shouldReloadClientEntry = true;
				}
			}
			if (changesRouteLoaderSource) {
				const previousHint = clientRouteLoaderHints[relative] === true;
				try {
					const nextHints = createRouteLoaderHintsForVirtualModules(resolved, root);
					shouldReloadClientEntry ||= previousHint !== (nextHints[relative] === true);
					clientRouteLoaderHints = nextHints;
				} catch {
					shouldReloadClientEntry = true;
				}
			}
			if (isPagesMode && relative.startsWith(resolved.pagesDir)) {
				clearPagesAppSourceCache();
				invalidateVirtualModules(server);
				const sentFullReload = sendServerOnlyFullReload(server, file);
				if (!sentFullReload && !shouldReloadClientEntry) sendRouteDataStale(server);
				if (!sentFullReload && shouldReloadClientEntry && clientHeadModule) return [...new Set([...modules, clientHeadModule])];
				return;
			}
			if (!isPagesMode && relative === resolved.appFile) {
				server.restart();
				return [];
			}
			if ([
				resolved.routesDir,
				resolved.shellsDir,
				resolved.middlewareDir,
				resolved.apiDir,
				resolved.serverDir,
				resolved.islandsDir,
				resolved.capabilitiesDir
			].some((dir) => relative.startsWith(dir))) {
				const serverMod = server.moduleGraph.getModuleById(PRACHT_SERVER_MODULE_ID);
				if (serverMod) server.moduleGraph.invalidateModule(serverMod);
				const devMod = server.moduleGraph.getModuleById(PRACHT_DEV_MODULE_ID);
				if (devMod) server.moduleGraph.invalidateModule(devMod);
				if (relative.startsWith(resolved.routesDir) || relative.startsWith(resolved.shellsDir)) {
					const clientMod = server.moduleGraph.getModuleById(PRACHT_CLIENT_MODULE_ID);
					if (clientMod) server.moduleGraph.invalidateModule(clientMod);
				}
				if (relative.startsWith(resolved.islandsDir)) {
					const islandsMod = server.moduleGraph.getModuleById(PRACHT_ISLANDS_CLIENT_MODULE_ID);
					if (islandsMod) server.moduleGraph.invalidateModule(islandsMod);
				}
				if (relative.startsWith(resolved.capabilitiesDir)) for (const moduleId of [
					PRACHT_CAPABILITIES_MODULE_ID,
					PRACHT_WEBMCP_MODULE_ID,
					PRACHT_CLIENT_MODULE_ID,
					PRACHT_ISLANDS_CLIENT_MODULE_ID
				]) {
					const capabilityMod = server.moduleGraph.getModuleById(moduleId);
					if (capabilityMod) server.moduleGraph.invalidateModule(capabilityMod);
				}
			}
			const sentFullReload = sendServerOnlyFullReload(server, file);
			if (!sentFullReload && shouldReloadClientEntry && clientHeadModule) return [...new Set([...modules, clientHeadModule])];
			if (!sentFullReload && (changesRouteHeadSource || changesRouteLoaderDependency)) sendRouteDataStale(server);
		}
	};
	const configuredBasePlugin = {
		name: "pracht:configured-base",
		config: {
			order: "post",
			handler(config) {
				configuredBase = typeof config.base === "string" ? config.base : void 0;
			}
		}
	};
	const clientModuleTransformPlugin = {
		name: "pracht:client-module-transform",
		enforce: "post",
		transform(code, id, transformOptions) {
			if (!transformOptions?.ssr && isCapabilityModule(id, capabilityModulePaths)) throw new Error(`[pracht] Capability module ${JSON.stringify(toPosixPath(id))} was imported by client code. Capability modules are server-only — their run() implementation and its imports would be bundled for every visitor. Call the capability instead: \`callCapability\`/\`capabilities\` from "virtual:pracht/capabilities" in the browser, or \`invokeCapability\` from "@pracht/core/server" in loaders, middleware, and API routes.`);
			if (!(isPrachtClientModuleId(id) || !transformOptions?.ssr && isRouteOrShellFile(id, routeFileDirs, routeFileExtensions))) return null;
			const transformed = stripServerOnlyExportsForClient(code, id);
			if (transformed === code) return null;
			return {
				code: transformed,
				map: null
			};
		}
	};
	const edgeRuntimeSafetyPlugin = resolved.adapter.edge ? createEdgeRuntimeSafetyPlugin() : null;
	const optimizeDepsEntriesPlugin = {
		name: "pracht:optimize-deps-entries",
		enforce: "post",
		config(config) {
			return withPrachtOptimizeDepsEntries(config, resolved, createPrachtOptimizeDepsInclude(config.root ?? process.cwd()));
		}
	};
	const precompilePlugin = resolved.precompileSsrJsx ? preactSsrPrecompile({
		...resolved.precompileSsrJsx === true ? {} : resolved.precompileSsrJsx,
		ssrOnly: true
	}) : null;
	const preactPlugins = preact();
	const clientModulePrefreshPlugin = createClientModulePrefreshPlugin(preactPlugins, { isRouteOrShellModule: (id) => isRouteOrShellFile(id, routeFileDirs, routeFileExtensions) });
	const plugins = [
		...precompilePlugin ? [precompilePlugin] : [],
		...preactPlugins,
		prachtPlugin,
		configuredBasePlugin,
		clientModuleTransformPlugin,
		...clientModulePrefreshPlugin ? [clientModulePrefreshPlugin] : [],
		...edgeRuntimeSafetyPlugin ? [edgeRuntimeSafetyPlugin] : [],
		createEnvSafetyPlugin(resolved.envSafety)
	];
	const adapterPlugins = isGraphOnlyMode() ? resolved.adapter.graphVitePlugins?.() : resolved.adapter.vitePlugins?.();
	if (adapterPlugins?.length) plugins.push(...adapterPlugins);
	plugins.push(optimizeDepsEntriesPlugin);
	return plugins;
}
function assertSafeRootAbsoluteDeployBase(base) {
	if (typeof base !== "string" || !base.startsWith("/") || base.startsWith("//")) return;
	let safe = !base.includes("?") && !base.includes("#");
	if (safe) try {
		const segments = base.split("/");
		safe = segments.every((segment, index) => {
			if (segment === "" && index !== 0 && index !== segments.length - 1) return false;
			const decoded = decodeURIComponent(segment);
			if (decoded === "." || decoded === "..") return false;
			for (const character of decoded) {
				const codePoint = character.codePointAt(0);
				if (character === "/" || character === "\\" || codePoint === 0 || codePoint !== void 0 && (codePoint <= 31 || codePoint === 127)) return false;
			}
			return true;
		});
	} catch {
		safe = false;
	}
	if (!safe) throw new Error(`[pracht] Vite \`base\` is set to ${JSON.stringify(base)}, but root-absolute deploy bases must contain safe URL segments. Repeated slashes, malformed escapes, and segments that decode to a path separator, \`.\`, \`..\`, NUL, or another control character are not allowed.`);
}
function isGraphOnlyMode() {
	return process.env[PRACHT_GRAPH_ONLY_ENV] === "1";
}
function createEdgeRuntimeSafetyPlugin() {
	let isSsrBuild = false;
	return {
		name: "pracht:edge-runtime-safety",
		apply: "build",
		enforce: "post",
		configResolved(config) {
			isSsrBuild = !!config.build.ssr;
		},
		generateBundle(_options, bundle) {
			const consumer = this.environment?.config?.consumer;
			if (!(consumer ? consumer === "server" : isSsrBuild)) return;
			const survivors = [];
			for (const [fileName, output] of Object.entries(bundle)) {
				if (output.type !== "chunk") continue;
				for (const specifier of collectNodeBuiltinImports(this.parse(output.code))) survivors.push({
					chunk: fileName,
					specifier
				});
			}
			if (survivors.length === 0) return;
			this.error([
				"[pracht] Edge server bundle retains Node.js builtin imports that are unavailable at runtime:",
				...survivors.map(({ chunk, specifier }) => `  - ${specifier} in ${chunk}`),
				"Remove the Node-only dependency or move that route to a Node deployment target."
			].join("\n"));
		}
	};
}
function collectNodeBuiltinImports(program) {
	const imports = /* @__PURE__ */ new Set();
	function sourceValue(node) {
		if (!node || typeof node !== "object" || !("value" in node)) return null;
		return typeof node.value === "string" ? node.value : null;
	}
	function visit(node) {
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (!node || typeof node !== "object") return;
		const record = node;
		const type = record.type;
		if (type === "ImportDeclaration" || type === "ExportAllDeclaration" || type === "ExportNamedDeclaration" || type === "ImportExpression") {
			const specifier = sourceValue(record.source);
			if (specifier && isBuiltin(specifier)) imports.add(specifier);
		} else if (type === "CallExpression") {
			const callee = record.callee;
			const isImport = callee?.type === "Import";
			const isRequire = callee?.type === "Identifier" && callee.name === "require";
			if (isImport || isRequire) {
				const specifier = sourceValue(record.arguments?.[0]);
				if (specifier && isBuiltin(specifier)) imports.add(specifier);
			}
		}
		for (const value of Object.values(record)) visit(value);
	}
	visit(program);
	return imports;
}
const MANIFEST_CORE_IMPORTS = new Set([
	"defineApp",
	"group",
	"route",
	"timeRevalidate"
]);
function rewriteManifestCoreImports(code) {
	return code.replace(/import\s+(type\s+)?\{([^}]+)\}\s+from\s+(['"])@pracht\/core\3/g, (match, typeKeyword, specifiers, quote) => {
		const valueImports = specifiers.split(",").map((specifier) => specifier.trim()).filter(Boolean).filter((specifier) => !specifier.startsWith("type ")).map((specifier) => specifier.split(/\s+as\s+/)[0]?.trim()).filter(Boolean);
		if (!typeKeyword && valueImports.some((specifier) => !MANIFEST_CORE_IMPORTS.has(specifier))) return match;
		return `import ${typeKeyword ?? ""}{${specifiers}} from ${quote}@pracht/core/manifest${quote}`;
	});
}
const PRACHT_OPTIMIZE_DEPS_INCLUDE = [
	"@pracht/core",
	"@pracht/core/client",
	"@pracht/core/islands-client",
	"@pracht/core/manifest"
];
const PREACT_DEDUPE = ["preact", "preact-render-to-string"];
const PRACHT_SSR_NO_EXTERNAL = /^@pracht\//;
function createPrachtOptimizeDepsInclude(root) {
	try {
		if (!toPosixPath(createRequire(join(root, "package.json")).resolve("@pracht/core/package.json")).includes("/node_modules/")) return [];
		return PRACHT_OPTIMIZE_DEPS_INCLUDE;
	} catch {
		return [];
	}
}
function withPrachtOptimizeDepsEntries(config, resolved, prachtInclude) {
	const prachtEntries = createPrachtOptimizeDepsEntries(resolved, config.optimizeDeps?.extensions);
	const environments = Object.fromEntries(Object.entries(config.environments ?? {}).map(([name, environment]) => [name, { optimizeDeps: { entries: mergeOptimizeDepsEntries(environment.optimizeDeps?.entries, createPrachtOptimizeDepsEntries(resolved, environment.optimizeDeps?.extensions ?? config.optimizeDeps?.extensions)) } }]));
	return {
		optimizeDeps: {
			entries: mergeOptimizeDepsEntries(config.optimizeDeps?.entries, prachtEntries),
			...prachtInclude.length > 0 ? { include: mergeOptimizeDepsEntries(config.optimizeDeps?.include, prachtInclude) } : {}
		},
		...Object.keys(environments).length > 0 ? { environments } : {}
	};
}
const VITE_SCANNABLE_ROUTE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mts",
	".mjs",
	".cts",
	".cjs",
	".vue",
	".svelte",
	".astro",
	".imba"
]);
function createPrachtOptimizeDepsEntries(resolved, optimizerExtensions) {
	const scriptExtensions = "{ts,tsx,js,jsx}";
	const explicitlyScannable = new Set(optimizerExtensions ?? []);
	const routeExtensions = extensionGlob([...new Set([...DEFAULT_ROUTE_EXTENSIONS, ...resolved.additionalExtensions])].filter((extension) => VITE_SCANNABLE_ROUTE_EXTENSIONS.has(extension) || explicitlyScannable.has(extension)));
	const apiDir = toOptimizeDepsEntry(resolved.apiDir);
	const apiEntries = [`${apiDir}/**/*.{ts,js,tsx,jsx}`, `!${apiDir}/**/*.d.ts`];
	const entries = resolved.pagesDir ? [
		`${toOptimizeDepsEntry(resolved.pagesDir)}/**/*.${routeExtensions}`,
		`${toOptimizeDepsEntry(resolved.middlewareDir)}/**/*.${scriptExtensions}`,
		...apiEntries,
		`${toOptimizeDepsEntry(resolved.serverDir)}/**/*.{ts,js,tsx,jsx}`,
		`${toOptimizeDepsEntry(resolved.islandsDir)}/**/*.${scriptExtensions}`
	] : [
		toOptimizeDepsEntry(resolved.appFile),
		`${toOptimizeDepsEntry(resolved.routesDir)}/**/*.${routeExtensions}`,
		`${toOptimizeDepsEntry(resolved.shellsDir)}/**/*.${routeExtensions}`,
		`${toOptimizeDepsEntry(resolved.middlewareDir)}/**/*.${scriptExtensions}`,
		...apiEntries,
		`${toOptimizeDepsEntry(resolved.serverDir)}/**/*.{ts,js,tsx,jsx}`,
		`${toOptimizeDepsEntry(resolved.islandsDir)}/**/*.${scriptExtensions}`,
		`${toOptimizeDepsEntry(resolved.capabilitiesDir)}/**/*.{ts,js,tsx,jsx}`
	];
	return [...new Set(entries.filter(Boolean))];
}
function mergeOptimizeDepsEntries(userEntries, prachtEntries) {
	return [...new Set([...Array.isArray(userEntries) ? userEntries : userEntries ? [userEntries] : [], ...prachtEntries])];
}
function toOptimizeDepsEntry(path) {
	return toPosixPath(path).replace(/^\.\//, "").replace(/^\//, "").replace(/\/$/, "");
}
function watchPagesDirectory(server, resolved, root) {
	const abs = resolveConfigPath(root, resolved.pagesDir);
	server.watcher.on("add", (f) => {
		if (toPosixPath(f).startsWith(toPosixPath(abs))) {
			clearPagesAppSourceCache();
			server.restart();
		}
	});
	server.watcher.on("unlink", (f) => {
		if (toPosixPath(f).startsWith(toPosixPath(abs))) {
			clearPagesAppSourceCache();
			server.restart();
		}
	});
}
function invalidateVirtualModules(server) {
	const clientMod = server.moduleGraph.getModuleById(PRACHT_CLIENT_MODULE_ID);
	const serverMod = server.moduleGraph.getModuleById(PRACHT_SERVER_MODULE_ID);
	const devMod = server.moduleGraph.getModuleById(PRACHT_DEV_MODULE_ID);
	if (clientMod) server.moduleGraph.invalidateModule(clientMod);
	if (serverMod) server.moduleGraph.invalidateModule(serverMod);
	if (devMod) server.moduleGraph.invalidateModule(devMod);
}
function computeRouteFileDirs(root, resolved) {
	return (resolved.pagesDir ? [resolved.pagesDir] : [resolved.routesDir, resolved.shellsDir]).map((dir) => canonicalFilePath(resolveConfigPath(root, dir))).map(withTrailingSep);
}
/**
* Whether `id` is one of the capability modules the manifest registers.
* Matching the registered set rather than a directory keeps ordinary files that
* merely live beside capabilities importable, and still catches a capability
* registered from anywhere else in the project. Extension-agnostic, because the
* comparison is against paths the manifest already resolved.
*/
function isCapabilityModule(id, capabilityModulePaths) {
	if (capabilityModulePaths.size === 0) return false;
	const queryStart = id.indexOf("?");
	const path = queryStart === -1 ? id : id.slice(0, queryStart);
	if (path.startsWith("\0") || path.startsWith("virtual:")) return false;
	return capabilityModulePaths.has(canonicalFilePath(path));
}
/**
* Match Vite's canonical module ids even when the manifest path crosses a
* symlink (including macOS' /var -> /private/var alias). Missing paths keep
* their lexical identity so the projection code can raise its precise missing
* capability error later.
*/
function canonicalFilePath(path) {
	try {
		return toPosixPath(realpathSync.native(path));
	} catch {
		return toPosixPath(path);
	}
}
function isRouteOrShellFile(id, dirs, extensions) {
	if (dirs.length === 0) return false;
	const queryStart = id.indexOf("?");
	const path = queryStart === -1 ? id : id.slice(0, queryStart);
	if (path.startsWith("\0") || path.startsWith("virtual:")) return false;
	const extIndex = path.lastIndexOf(".");
	if (extIndex === -1) return false;
	const ext = path.slice(extIndex);
	if (!extensions.has(ext)) return false;
	const normalized = toPosixPath(path);
	return dirs.some((dir) => normalized.startsWith(dir));
}
function resolveConfigPath(root, configPath) {
	const normalizedRoot = toPosixPath(root).replace(/\/$/, "");
	const relativePath = configPath.replace(/^\//, "");
	if (normalizedRoot.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedRoot)) return `${normalizedRoot}/${relativePath}`;
	return toPosixPath(resolve(root, relativePath));
}
function toPosixPath(p) {
	return p.replace(/\\/g, "/");
}
function withTrailingSep(p) {
	return p.endsWith("/") ? p : `${p}/`;
}
//#endregion
export { FRAMEWORK_VENDOR_CHUNK, PRACHT_CAPABILITIES_MODULE_ID, PRACHT_CLIENT_MODULE_ID, PRACHT_ISLANDS_CLIENT_MODULE_ID, PRACHT_SERVER_MODULE_ID, PRACHT_WEBMCP_MODULE_ID, PUBLIC_ENV_PREFIX, VITE_BUILTIN_ENV_VARS, createEnvSafetyPlugin, createPrachtCapabilitiesClientModuleSource, createPrachtClientModuleSource, createPrachtIslandsClientModuleSource, createPrachtRegistryModuleSource, createPrachtServerModuleSource, createPrachtWebmcpModuleSource, extractCapabilities, formatEnvLeakError, frameworkChunkGroups, pracht, scanCodeForEnvLeaks };
