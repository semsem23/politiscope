import { defineConfig } from "vitest/config";

// Tests purs (pipeline, filtres) : aucun DOM, aucun réseau.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
