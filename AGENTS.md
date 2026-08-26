# Pracht App

## Commands

- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run deploy` — build and deploy

## Scaffolding

Use the CLI to generate new files:

- `pracht generate route --path /about` — add a route
- `pracht generate shell --name app` — add a shell
- `pracht generate middleware --name auth` — add middleware
- `pracht generate api --path /health --methods GET` — add an API route
- `pracht generate capability --name notes.search --effect read --expose http` — add a capability (agent-callable operation)
- `pracht doctor` — check project health
- `pracht verify` — enforce route and constraint invariants
- `pracht plan --write` — refresh the committed `.pracht/app-graph.json` snapshot after route changes
- `pracht report` — PR-ready markdown summary (plan diff, verify, budgets)
- `pracht llms --write` — write an `llms.txt` authoring guide for coding agents

## Project structure

This app uses **manifest routing**.

- `src/routes.ts` — route manifest (defines all routes and shells)
- `src/routes/` — route components and loaders
- `src/routes/not-found.tsx` — not-found page, wired via `notFound` in the manifest
- `src/shells/` — shell components (layouts)
- `src/api/` — API route handlers
- `vite.config.ts` — Vite config with the Vercel adapter
- `src/styles/global.css` — Tailwind CSS entry stylesheet, imported by the shell

## Agent tooling

- `.claude/skills/` — pracht Claude Code skills (audits, scaffolds, testing, debugging); invoke with `/<skill-name>`
- `.mcp.json` — registers the `pracht mcp` server so MCP clients can inspect the app graph, run doctor/verify, and scaffold natively
