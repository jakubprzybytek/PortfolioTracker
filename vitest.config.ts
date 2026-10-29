import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `npm run test:coverage`: unit-test coverage of the code (the integration and E2E tests run against a stage).
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**", "packages/jobs/src/**", "packages/web/src/**"],
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
    },
    projects: [
      {
        test: {
          name: "unit",
          include: ["packages/core/test/**/*.test.ts", "packages/jobs/test/unit/**/*.test.ts", "packages/web/test/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["packages/jobs/test/integration/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
