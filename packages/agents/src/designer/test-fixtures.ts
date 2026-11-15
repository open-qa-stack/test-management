import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { applicationVariable, appsFrom, sharedFixtures } from "@open-qa-stack/shared";
import { TEST_MODULE } from "./spec-rules.ts";
import type { WrittenFiles } from "./written-files.ts";

/** The file of the fixtures the tests of a repository share. */
export interface FixturesFile {
  /** Its path, relative to the root of the test repository. */
  readonly path: string;
  /** Identifiers of the applications it gives as fixtures, each with its page objects. */
  readonly applications: readonly string[];
}

/** What a test is given: the module its `test` and its `expect` come from, and the applications that module gives as fixtures. */
export interface TestFixtures {
  readonly module: string;
  readonly applications: readonly string[];
}

/** A test of a repository without a file of fixtures: it imports Playwright itself, and opens the tab of each other application. */
export const PLAYWRIGHT_ALONE: TestFixtures = { module: TEST_MODULE, applications: [] };

/**
 * Reads the file of the fixtures the tests of a repository share, and writes it when the repository has
 * none.
 *
 * @remarks
 * A file already there is the team's and is kept as it is: only the applications it names are taken as
 * given, and a test opens the tab of another itself.
 *
 * @param repositoryRoot - Absolute path of the test repository.
 * @param path - Path of the file, relative to the root, as the configuration gives it.
 * @param appsDir - Folder of the applications, relative to the root.
 * @param applications - Identifiers of the applications that have a user interface.
 * @param written - The files the design writes, which a file written now is one of.
 * @returns The file.
 */
export async function ensureFixtures(
  repositoryRoot: string,
  path: string,
  appsDir: string,
  applications: readonly string[],
  written: WrittenFiles,
): Promise<FixturesFile> {
  const existing = await readFile(join(repositoryRoot, path), "utf8").catch(() => undefined);
  const content = existing ?? sharedFixtures(applications, appsFrom(path, appsDir));
  if (existing === undefined) await written.write(path, content);
  return { path, applications: applications.filter((id) => new RegExp(`\\b${applicationVariable(id)}:`).test(content)) };
}

/**
 * What the test at a path is given by the file of the fixtures.
 *
 * @param testPath - Path of the test, relative to the root of the test repository.
 * @param file - The file of the fixtures; none when the repository has none.
 * @returns The module the test imports, relative to its folder, and the applications it gives.
 */
export function fixturesFor(testPath: string, file: FixturesFile | undefined): TestFixtures {
  if (file === undefined) return PLAYWRIGHT_ALONE;
  const module = posix.relative(posix.dirname(testPath), file.path);
  return { module: module.startsWith(".") ? module : `./${module}`, applications: file.applications };
}
