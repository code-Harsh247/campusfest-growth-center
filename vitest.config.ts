import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(process.cwd(), "src") } },
  test: {
    testTimeout: 120_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
