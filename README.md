# pract-dpu

This pracht starter is configured for Vercel.

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run typecheck`
- `npm run deploy`

Run the deploy command after linking or logging into your Vercel account.

## Files

- `src/routes.ts` defines your app manifest.
- `src/routes/home.tsx` is the first page.
- `src/routes/not-found.tsx` is the not-found page, wired via `notFound`.
- `src/api/health.ts` is a sample API route.
- `src/styles/global.css` is the Tailwind CSS entry, imported by the shell.
- `.claude/skills/` and `.mcp.json` wire up the pracht Claude Code skills and MCP server.

## Checks

- `pracht verify` validates routes and constraints.
- `pracht plan --write` commits an app-graph snapshot to `.pracht/`; `pracht plan` diffs against it.
- `pracht report` prints a PR-ready summary of both.
