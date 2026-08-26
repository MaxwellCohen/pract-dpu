/**
 * Rebuild vendor/pracht-streaming-pr from the open streaming SSR PR branch.
 *
 * Source: https://github.com/JoviDeCroock/pracht/pull/340
 * Branch: JoviDeCroock/streaming-ssr
 *
 * Usage: npm run sync:pracht-pr
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor/pracht-streaming-pr");
const BRANCH = "JoviDeCroock/streaming-ssr";
const REPO = "https://github.com/JoviDeCroock/pracht.git";

const PACKAGES = [
  "capabilities",
  "preact-ssr-precompile",
  "adapter-node",
  "framework",
  "vite-plugin",
  "adapter-vercel",
  "cli",
];

const NAME_TO_DIR = {
  "@pracht/capabilities": "capabilities",
  "@pracht/core": "framework",
  "@pracht/adapter-node": "adapter-node",
  "@pracht/preact-ssr-precompile": "preact-ssr-precompile",
  "@pracht/vite-plugin": "vite-plugin",
  "@pracht/adapter-vercel": "adapter-vercel",
  "@pracht/cli": "cli",
};

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pracht-streaming-pr-"));
try {
  run("git", ["clone", "--depth", "1", "--branch", BRANCH, REPO, tmp]);
  run("pnpm", ["install", "--ignore-scripts"], tmp);
  run("pnpm", ["build"], tmp);

  fs.rmSync(VENDOR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR, { recursive: true });

  for (const pkg of PACKAGES) {
    const src = path.join(tmp, "packages", pkg);
    const dest = path.join(VENDOR, pkg);
    fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(path.join(src, "package.json"), path.join(dest, "package.json"));
    for (const name of ["dist", "bin", "LICENSE", "README.md", "CHANGELOG.md"]) {
      const from = path.join(src, name);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, path.join(dest, name), { recursive: true });
    }
  }

  for (const dir of Object.values(NAME_TO_DIR)) {
    const pkgPath = path.join(VENDOR, dir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (!String(pkg.version).includes("streaming")) {
      pkg.version = `${pkg.version}-streaming.pr340`;
    }
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const [name, version] of Object.entries(deps)) {
        if (version === "workspace:*" && NAME_TO_DIR[name]) {
          deps[name] = `file:${path.relative(
            path.join(VENDOR, dir),
            path.join(VENDOR, NAME_TO_DIR[name]),
          )}`;
        }
      }
    }
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: tmp, encoding: "utf8" }).trim();
  fs.writeFileSync(path.join(VENDOR, "BRANCH"), `${BRANCH}\n`);
  fs.writeFileSync(path.join(VENDOR, "COMMIT"), `${commit}\n`);
  fs.writeFileSync(
    path.join(VENDOR, "README.md"),
    `# Pracht streaming SSR PR vendor

Built from [\`pracht#${BRANCH}\`](https://github.com/JoviDeCroock/pracht/tree/${BRANCH})
(PR https://github.com/JoviDeCroock/pracht/pull/340).

Commit: \`${commit}\`

Refresh with \`npm run sync:pracht-pr\`, then \`npm install\`.
`,
  );

  console.log(`\nVendored ${BRANCH} @ ${commit} → vendor/pracht-streaming-pr`);
  console.log("Next: npm install");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
