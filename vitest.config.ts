import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    // Testing Library only registers its auto-cleanup when `afterEach` is a
    // global. Without it, one component's DOM leaks into the next test and
    // queries start matching elements from a render that already finished.
    globals: true,
    include: [
      "packages/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.ts",
      "apps/**/test/**/*.test.tsx",
    ],
    environmentMatchGlobs: [["apps/web/**", "jsdom"]],
  },
});
