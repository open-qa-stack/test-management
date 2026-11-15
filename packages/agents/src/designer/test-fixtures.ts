import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { FIXTURES_FILE_NAME, sharedFixtures, tabVariable } from "@open-qa-stack/shared";
import { TEST_MODULE } from "./spec-rules.ts";

/** The file of the fixtures the tests of a repository share. */
export interface FixturesFile {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** The tabs of applications it gives, by the name of their fixture. */
  readonly tabs: readonly string[];
  /** Whether it was written now: the repository had none. */
  readonly created: boolean;
}

/** What a test is given: the module its `test` and its `expect` come from, and the tabs that module gives as fixtures. */
export interface TestFixtures {
  readonly module: string;
  readonly tabs: readonly string[];
}

/** A test of a repository without a file of fixtures: it imports Playwright itself, and opens its tabs. */
export const PLAYWRIGHT_ALONE: TestFixtures = { module: TEST_MODULE, tabs: [] };

/**
 * Reads the file of the fixtures the tests of a repository share, and writes it when the repository has
 * none.
 *
 * @remarks
 * A file already there is the team's and is kept as it is: only the tabs it names are taken as given, and a
 * test opens the others itself.
 *
 * @param repositoryRoot - Absolute path of the test repository.
 * @param appsDir - Folder of the applications, relative to the root.
 * @param applications - Identifiers of the applications the repository tests.
 * @returns The file.
 */
export async function ensureFixtures(repositoryRoot: string, appsDir: string, applications: readonly string[]): Promise<FixturesFile> {
  const path = posix.join(appsDir, FIXTURES_FILE_NAME);
  const target = join(repositoryRoot, path);
  const existing = await readFile(target, "utf8").catch(() => undefined);
  const content = existing ?? sharedFixtures(applications);
  if (existing === undefined) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  const tabs = applications.map(tabVariable).filter((tab) => new RegExp(`\\b${tab}\\b`).test(content));
  return { path, tabs, created: existing === undefined };
}

/**
 * What the test at a path is given by the file of the fixtures.
 *
 * @param testPath - Path of the test, relative to the root of the test repository.
 * @param file - The file of the fixtures; none when the repository has none.
 * @returns The module the test imports, relative to its folder, and the tabs it gives.
 */
export function fixturesFor(testPath: string, file: FixturesFile | undefined): TestFixtures {
  if (file === undefined) return PLAYWRIGHT_ALONE;
  const module = posix.relative(posix.dirname(testPath), file.path);
  return { module: module.startsWith(".") ? module : `./${module}`, tabs: file.tabs };
}
