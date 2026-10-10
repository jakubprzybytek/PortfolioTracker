import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/core/test/**/*.test.ts", "packages/jobs/test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/jobs/test/integration/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
