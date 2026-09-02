/**
 * Rebuild the local preact-render-to-string checkout and copy src/dist
 * into this app's node_modules.
 *
 * Default checkout: /Users/maxcohen/code/preactjs/preact-render-to-string
 * Override with PREACT_RTS=/path/to/preact-render-to-string
 *
 * Usage: pnpm sync:rts
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_RTS = "/Users/maxcohen/code/preactjs/preact-render-to-string";
const RTS = path.resolve(process.env.PREACT_RTS || DEFAULT_RTS);
const DEST = path.join(ROOT, "node_modules/preact-render-to-string");

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

if (!fs.existsSync(path.join(RTS, "package.json"))) {
  throw new Error(`preact-render-to-string checkout not found: ${RTS}`);
}

run("npm", ["run", "build"], RTS);

if (!fs.existsSync(DEST)) {
  throw new Error(
    `Missing ${DEST}. Run pnpm install first so the local RTS link exists.`,
  );
}

run(
  "rsync",
  [
    "-a",
    "--delete",
    "--exclude",
    "node_modules",
    "--exclude",
    ".git",
    `${path.join(RTS, "src")}/`,
    `${path.join(DEST, "src")}/`,
  ],
  ROOT,
);
run("rsync", ["-a", "--delete", `${path.join(RTS, "dist")}/`, `${path.join(DEST, "dist")}/`], ROOT);
run("pnpm", ["install"], ROOT);

console.log(`\nSynced ${RTS} → ${DEST}`);
console.log("Restart pnpm dev if it is running.");
