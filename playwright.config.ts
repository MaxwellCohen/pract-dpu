import { defineConfig } from "@playwright/test";

// BASE_URL=https://pract-dpu.vercel.app pnpm test   → run against a deployment
// (no BASE_URL)                                       → builds nothing; starts `pracht dev`
const baseURL = process.env.BASE_URL ?? "http://localhost:3104";

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "results/results.json" }]],
  use: { baseURL },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "pnpm exec pracht dev --port 3104",
        url: "http://localhost:3104/api/health",
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
