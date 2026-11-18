import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Refuses, in the tests of a package that opens connections, any that leaves the machine. */
const LOOPBACK_ONLY = fileURLToPath(new URL("./packages/testing/src/loopback-only.ts", import.meta.url));

/**
 * The tests of a package, as a project of their own.
 *
 * @param root - The folder of the package, from the root of the workspace.
 * @param test - What its tests need beside the settings they all share.
 * @returns The project, named after its folder.
 */
const project = (root: string, test: Record<string, unknown> = {}) => ({
  extends: true as const,
  test: { name: root.split("/").at(-1)!, root, include: ["test/**/*.test.ts"], ...test },
});

/**
 * The tests of the workspace: one project per package, their files side by side in a pool of processes sized to
 * the machine, each file in a process of its own. A test never runs twice, and all of them together cover every
 * file of code, file by file.
 */
export default defineConfig({
  test: {
    // A test file is a process of its own: the tests of the tools drive real browsers and real git repositories.
    pool: "forks",
    // No test is retried: one that fails once has failed.
    retry: 0,
    // A test may start a browser, a server or a git repository, which takes seconds; none has minutes to wait.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    projects: [
      project("packages/domain"),
      project("packages/shared", { setupFiles: ["./test/no-network.ts"] }),
      project("packages/testing"),
      project("packages/tools", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/harness", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/agents", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/cli", { setupFiles: [LOOPBACK_ONLY] }),
      project("apps/web"),
      project("lint"),
    ],
    coverage: {
      provider: "v8",
      // The code of each package and the lint rules. Vitest reads these patterns from the root of the workspace on a
      // full run, and from the folder of each project when `--project` picks some: they are written for both.
      include: ["{packages,apps}/*/src/**/*.{ts,tsx}", "lint/*.ts", "src/**/*.{ts,tsx}", "*.ts"],
      exclude: [
        "{packages,apps}/*/test/**",
        "lint/test/**",
        "test/**",
        "packages/{api,check}/**",
        "vitest.config.ts",
        "**/vite.config.ts",
        "**/src/main.ts",
        "**/src/main.tsx",
        "**/src/app.tsx",
        "**/src/source-code/search-worker.ts",
        "**/check-manifests.ts",
      ],
      reportsDirectory: process.env["OQAS_COVERAGE_DIRECTORY"] ?? "coverage",
      reporter: ["text-summary", "lcovonly"],
      thresholds: { perFile: true, lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
});
