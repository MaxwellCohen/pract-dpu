import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { pracht } from "@pracht/vite-plugin";
import { vercelAdapter } from "@pracht/adapter-vercel";
import tailwindcss from "@tailwindcss/vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // preact-suspense does not drive preact-render-to-string streaming;
      // compat Suspense does.
      "preact-suspense": path.join(root, "src/shims/preact-suspense.ts"),
    },
  },
  plugins: [pracht({ adapter: vercelAdapter(), llmsTxt: {} }), tailwindcss()],
});
