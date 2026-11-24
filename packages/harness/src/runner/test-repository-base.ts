import {
  applicationPages,
  appsFrom,
  baseUrlVariable,
  DATABASE_FILE_NAME,
  PAGES_FOLDER,
  PAGES_INDEX,
  sharedFixtures,
  STORED_DOCUMENTS_FOLDER,
} from "@open-qa-stack/domain";
import { testRepositoryReadme } from "./test-repository-readme.ts";
import { testRepositoryWorkflow } from "./test-repository-workflow.ts";

/** A file of the base of a test repository. */
export interface BaseFile {
  /** Path relative to the root of the test repository. */
  readonly path: string;
  readonly content: string;
}

/** The versions of the tools of a test repository that are not those of Playwright: its compiler and the types of Node.js. */
const TYPESCRIPT_VERSION = "7.0.2";
const NODE_TYPES_VERSION = "22.20.5";

/** Variable that names the environment the tests run against. */
export const ENVIRONMENT_VARIABLE = "OQAS_ENVIRONMENT";

export { baseUrlVariable };

/** The Playwright configuration of a test repository: a project per application, its tests in its folder. */
const PLAYWRIGHT_CONFIG = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// One project per application of oqas.json; the harness gives each its base address when it runs the tests.
interface Environment {
  name: string;
  uiUrl?: string;
  apis?: { baseUrl: string }[];
}
interface Application {
  id: string;
  environments: Environment[];
}
interface Configuration {
  applications: Application[];
  repository?: { appsDir?: string; stateDir?: string };
}

const config = JSON.parse(readFileSync(join(import.meta.dirname, "oqas.json"), "utf8")) as Configuration;
const appsDir = config.repository?.appsDir ?? "apps";
const stateDir = config.repository?.stateDir ?? ".oqas";
const environment = process.env.${ENVIRONMENT_VARIABLE};
const variable = (id: string) => \`OQAS_BASE_URL_\${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}\`;
// The base address of an application: its interface, or else its first API.
const baseOf = (env: Environment | undefined) => env?.uiUrl ?? env?.apis?.[0]?.baseUrl;

export default defineConfig({
  testDir: appsDir,
  outputDir: join(stateDir, "test-results"),
  // A test left focused never passes for the others, and none is retried: a test that fails once has failed.
  forbidOnly: true,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: join(stateDir, "report"), open: "never" }], ["junit", { outputFile: join(stateDir, "junit.xml") }]],
  // What is kept of a failed test, for the report: its trace and a screenshot.
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: config.applications.map((application) => ({
    name: application.id,
    testDir: join(appsDir, application.id, "tests"),
    use: { baseURL: process.env[variable(application.id)] ?? baseOf(application.environments.find((env) => env.name === environment)) },
  })),
});
`;

/** The project a test repository is initialised for. */
export interface TestProject {
  /** The exact version of `@playwright/test`. */
  readonly playwrightVersion: string;
  /** The applications the repository tests, as its configuration declares them. */
  readonly applications: readonly {
    readonly id: string;
    readonly name: string;
    /** Whether it has a user interface: its tests are then given its page objects. */
    readonly ui: boolean;
  }[];
  /** Folder of the applications, relative to the root of the repository. */
  readonly appsDir: string;
  /** Folder of what the runs leave, relative to the root of the repository. */
  readonly stateDir: string;
  /** Path of the file of the fixtures the tests share, relative to the root of the repository; none for tests that each stand alone. */
  readonly fixturesFile?: string;
  /** Whether the tests act on page objects, one class per screen; they act on the page itself otherwise. */
  readonly pageObjects: boolean;
}

/** The levels of the pyramid of tests, each with a script that runs its tests by their tag. */
const LEVELS = ["smoke", "functional", "business", "cross-application", "end-to-end"];

/**
 * The files of a test repository initialised as a Playwright project: its `package.json`, with
 * `@playwright/test` at an exact version and a script for each level of the pyramid of tests, its
 * `playwright.config.ts`, its `tsconfig.json`, its `.gitignore`, its `README.md`, the fixtures its tests
 * share and the workflow that verifies its tests on a pull request.
 *
 * @remarks
 * The lockfile is made by `npm install` from this `package.json`. The configuration imports only
 * `@playwright/test` and modules of Node.js: it reads the applications from `oqas.json`, so that the same
 * file serves a repository of one application or of several.
 *
 * @param project - The project: the version of Playwright, the applications and the folders.
 * @returns The files, each by its path relative to the root of the repository.
 */
export function testRepositoryBase(project: TestProject): BaseFile[] {
  const { playwrightVersion, applications, appsDir, stateDir, fixturesFile } = project;
  const screened = applications.filter((application) => application.ui);
  // The fixtures the tests share, and the file that gathers the page objects of each application, there from the start.
  const shared =
    fixturesFile === undefined
      ? []
      : [
          {
            path: fixturesFile,
            content: sharedFixtures(
              screened.map((application) => application.id),
              appsFrom(fixturesFile, appsDir),
            ),
          },
          ...screened.map((application) => ({
            path: `${appsDir}/${application.id}/${PAGES_FOLDER}/${PAGES_INDEX}`,
            content: applicationPages(application, []),
          })),
        ];
  const manifest = {
    name: "playwright-tests",
    private: true,
    type: "module",
    scripts: {
      test: "playwright test",
      ...Object.fromEntries(LEVELS.map((level) => [`test:${level}`, `playwright test --grep @level-${level}`])),
      "test:read-only": "playwright test --grep @data-read",
      "test:visual": "playwright test --grep @kind-visual",
      report: `playwright show-report ${stateDir}/report`,
      typecheck: "tsc --noEmit",
    },
    devDependencies: { "@playwright/test": playwrightVersion, "@types/node": NODE_TYPES_VERSION, typescript: TYPESCRIPT_VERSION },
  };
  const compiler = {
    compilerOptions: {
      target: "es2023",
      lib: ["es2023", "dom"],
      module: "preserve",
      moduleResolution: "bundler",
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: ["node"],
    },
    include: [appsDir, "playwright.config.ts"],
  };
  const ignored = [
    "node_modules/",
    `${stateDir}/test-results/`,
    `${stateDir}/report/`,
    `${stateDir}/junit.xml`,
    `${stateDir}/runs/`,
    `${stateDir}/traces/`,
    // The documents the instance keeps, which a run writes there for its agents to read: the database keeps them.
    `${stateDir}/${STORED_DOCUMENTS_FOLDER}/`,
    // The database of an instance that was given no other, with the files SQLite keeps beside it.
    `${stateDir}/${DATABASE_FILE_NAME}*`,
  ];
  return [
    { path: "package.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "playwright.config.ts", content: PLAYWRIGHT_CONFIG },
    { path: "tsconfig.json", content: `${JSON.stringify(compiler, null, 2)}\n` },
    { path: ".gitignore", content: `${ignored.join("\n")}\n` },
    { path: "README.md", content: testRepositoryReadme(project) },
    ...shared,
    { path: ".github/workflows/tests.yml", content: testRepositoryWorkflow() },
  ];
}
