import { baseUrlVariable } from "@open-qa-stack/shared";

/** A file of the base of a test repository. */
export interface BaseFile {
  /** Path relative to the root of the test repository. */
  readonly path: string;
  readonly content: string;
}

/** Variable that names the environment the tests run against. */
export const ENVIRONMENT_VARIABLE = "OQAS_ENVIRONMENT";

export { baseUrlVariable };

/** The Playwright configuration of a test repository: a project per application, its tests in its folder. */
const PLAYWRIGHT_CONFIG = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// One project per application of oqas.json; the harness gives each its base address when it runs the tests.
const config = JSON.parse(readFileSync(join(import.meta.dirname, "oqas.json"), "utf8"));
const appsDir = config.repository?.appsDir ?? "apps";
const stateDir = config.repository?.stateDir ?? ".oqas";
const environment = process.env.${ENVIRONMENT_VARIABLE};
const variable = (id) => \`OQAS_BASE_URL_\${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}\`;
// The base address of an application: its interface, or else its first API.
const baseOf = (env) => env?.uiUrl ?? env?.apis?.[0]?.baseUrl;

export default defineConfig({
  testDir: appsDir,
  outputDir: join(stateDir, "test-results"),
  forbidOnly: true,
  retries: 0,
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: config.applications.map((application) => ({
    name: application.id,
    testDir: join(appsDir, application.id),
    use: { baseURL: process.env[variable(application.id)] ?? baseOf(application.environments.find((env) => env.name === environment)) },
  })),
});
`;

/**
 * The files a test repository needs for its tests to run: its `package.json`, with
 * `@playwright/test` at an exact version, and its `playwright.config.ts`.
 *
 * @remarks
 * The lockfile is made by `npm install` from this `package.json`. The configuration imports only
 * `@playwright/test` and modules of Node.js: it reads the applications from `oqas.json`.
 *
 * @param playwrightVersion - The exact version of `@playwright/test`.
 * @returns The files.
 */
export function testRepositoryBase(playwrightVersion: string): BaseFile[] {
  const manifest = { name: "playwright-tests", private: true, type: "module", devDependencies: { "@playwright/test": playwrightVersion } };
  return [
    { path: "package.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "playwright.config.ts", content: PLAYWRIGHT_CONFIG },
  ];
}
