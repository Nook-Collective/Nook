import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: tests run in plain Node and do not
// start the Cloudflare dev environment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
