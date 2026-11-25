import { defineConfig } from "vitest/config";

/**
 * The tests of the check, which start it as a program on workspaces made for them. What they cover is measured by
 * Node.js itself, in their processes and in the programs they start, and reported by c8: the modules are loaded as
 * Node.js loads them, untransformed, so that what it measures is the code as it is written.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // A test file is a process of its own, as in the rest of the workspace.
    pool: "forks",
    experimental: { viteModuleRunner: false },
    setupFiles: ["./test/kept-coverage.ts"],
    // No test is retried: one that fails once has failed.
    retry: 0,
    // A test runs the whole check on a workspace, which takes seconds; none has minutes to wait.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
