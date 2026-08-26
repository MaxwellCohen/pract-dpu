import { defineConfig } from "vite";
import { pracht } from "@pracht/vite-plugin";
import { vercelAdapter } from "@pracht/adapter-vercel";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [pracht({ adapter: vercelAdapter(), llmsTxt: {} }), tailwindcss()],
});
