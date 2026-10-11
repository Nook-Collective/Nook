import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [preact(), cloudflare()],
  // Lets the dev server be opened through a GitHub Codespaces forwarded URL.
  server: { allowedHosts: [".app.github.dev"] },
});
