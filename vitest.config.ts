import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Refuses, in the tests of a package that opens connections, any that leaves the machine. */
const LOOPBACK_ONLY = fileURLToPath(new URL("./packages/testing/src/loopback-only.ts", import.meta.url));

/**
 * The tests of a package, as a project of their own.
 *
 * @param root - The folder of the package, from the root of the workspace.
 * @param test - What its tests need beside the settings they all share.
 * @returns The project, named after its folder unless its tests name it.
 */
const project = (root: string, test: Record<string, unknown> = {}) => ({
  extends: true as const,
  test: { name: root.split("/").at(-1)!, root, include: ["test/**/*.test.ts"], ...test },
});

/**
 * The folders of the packages to test, from the root of the workspace, which `OQAS_TEST_PACKAGES` names separated by
 * commas, as the check gives them for a pull request; every package when it names none.
 */
const CHOSEN = process.env["OQAS_TEST_PACKAGES"]?.split(",").filter((folder) => folder !== "");

/** Whether the tests of a folder run, and its code is measured. */
const chosen = (root: string): boolean => CHOSEN === undefined || CHOSEN.includes(root);

/** The code the tests measure, every file of it: that of the packages chosen, or of the whole workspace. */
const MEASURED =
  CHOSEN === undefined ? ["{packages,apps}/*/src/**/*.{ts,tsx}", "lint/*.ts", "src/**/*.{ts,tsx}", "*.ts"] : CHOSEN.map((root) => `${root}/src/**/*.{ts,tsx}`);

/** The tests of the store that are written once for every database it supports, which `OQAS_TEST_DATABASE` names to them. */
const ON_EACH_DATABASE = "test/each-database/**/*.test.ts";

/**
 * The tests of the workspace: one project per package, their files side by side in a pool of processes sized to
 * the machine, each file in a process of its own. A test never runs twice, but those of the store that are
 * written for every database it supports, which run once on each; all of them together cover every file of
 * code, file by file.
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
      project("packages/domain", { setupFiles: ["./test/no-network.ts"] }),
      project("packages/testing"),
      // The tests of the store on SQLite, with those that need no database: nothing runs beside them.
      project("packages/store", { setupFiles: [LOOPBACK_ONLY], include: ["test/*.test.ts", ON_EACH_DATABASE], env: { OQAS_TEST_DATABASE: "sqlite" } }),
      // The same tests on a real PostgreSQL server, started once for all of them, with those of what only a server does.
      project("packages/store", {
        name: "store-postgres",
        setupFiles: [LOOPBACK_ONLY],
        globalSetup: ["./test/support/global-setup.ts"],
        include: [ON_EACH_DATABASE, "test/postgres/**/*.test.ts"],
        env: { OQAS_TEST_DATABASE: "postgres" },
      }),
      project("packages/tools", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/harness", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/agents", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/engine", { setupFiles: [LOOPBACK_ONLY] }),
      project("packages/cli", { setupFiles: [LOOPBACK_ONLY] }),
      project("apps/web", { setupFiles: ["./test/in-french.ts"] }),
      project("lint"),
    ].filter(({ test }) => chosen(test.root)),
    coverage: {
      provider: "v8",
      // The code of each package and the lint rules. Vitest reads these patterns from the root of the workspace on a
      // full run, and from the folder of each project when `--project` picks some: they are written for both.
      include: MEASURED,
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
        "**/src/configuration/configuration-page.tsx",
        "**/src/configuration/use-configuration-editor.ts",
        "**/src/configuration/use-item-pages.ts",
        "**/src/applications/applications-page.tsx",
        "**/src/ui/side-panel.tsx",
        "**/src/discovery/discovery-page.tsx",
        "**/src/knowledge/knowledge-page.tsx",
        "**/src/tests/tests-page.tsx",
        "**/src/tests/test-page.tsx",
        "**/src/tests/test-text-panel.tsx",
        "**/src/executions/executions-page.tsx",
        "**/src/executions/execution-page.tsx",
        "**/src/executions/result-page.tsx",
        "**/src/executions/trace-page.tsx",
        "**/src/agent/agent-home-page.tsx",
        "**/src/agent/scope-picker.tsx",
        "**/src/campaigns/campaigns-page.tsx",
        "**/src/campaigns/campaign-page.tsx",
        "**/src/api/use-polled.ts",
        "**/src/source-code/search-worker.ts",
        "**/check-manifests.ts",
      ],
      reportsDirectory: process.env["OQAS_COVERAGE_DIRECTORY"] ?? "coverage",
      reporter: ["text-summary", "lcovonly"],
      // A part of the tests, run apart as `OQAS_TEST_PART` says, covers part of the code: the reports of every part,
      // merged, are held to the thresholds.
      ...(process.env["OQAS_TEST_PART"] === undefined ? { thresholds: { perFile: true, lines: 100, branches: 100, functions: 100, statements: 100 } } : {}),
    },
  },
});
