import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Tests unitaires du web (vitest). Les parcours dans un navigateur restent à
 * Playwright (`e2e/`), lancé contre la stack Docker.
 */
export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{js,jsx}"],
    environment: "node",
  },
});
