import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration for Recover.
 *
 * Test file convention: tests live next to their source files as
 * `*.test.ts` (or `*.test.tsx`), OR inside `__tests__/` directories
 * co-located with the module they cover. Both patterns are included
 * by default — pick whichever feels more natural for the module.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx", "**/__tests__/**/*.ts"],
    exclude: ["node_modules", ".next", "dist"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
