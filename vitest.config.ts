import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test files location
    include: ["tests/**/*.{test,spec}.{js,ts}"],

    // Test environment
    environment: "node",

    // Global test setup
    globals: true,

    // Coverage configuration
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.{js,ts}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{js,ts}",
        "src/**/*.spec.{js,ts}",
      ],
    },

    // Test timeout
    testTimeout: 10000,

    // Hook timeout
    hookTimeout: 10000,

    // Reporter
    reporter: ["verbose"],

    // Retry failed tests
    retry: 1,
  },
});
