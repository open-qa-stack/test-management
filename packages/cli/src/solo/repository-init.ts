import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { testRepositoryBase } from "@open-qa-stack/harness";
import { CONFIG_FILE_NAME, validateConfig, type EnvironmentVariables } from "@open-qa-stack/shared";
import { ExitCode, type ExitCodeValue } from "./exit-code.ts";

/** What the initialisation of a test repository needs. */
export interface RepositoryInitOptions {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** The exact version of `@playwright/test` the repository is initialised at. */
  readonly playwrightVersion: string;
  /** Writes a line of what went wrong. */
  readonly write: (line: string) => void;
  /** Prints a line of what was done. */
  readonly print: (line: string) => void;
}

/** An environment in which every variable is set: a repository is initialised without the secrets its runs need. */
const EVERY_VARIABLE_SET: EnvironmentVariables = new Proxy({}, { get: () => "set" });

/**
 * Initialises a test repository as a Playwright project, from its configuration.
 *
 * @remarks
 * It is a program, not an agent: the files are those `testRepositoryBase` gives for the applications the
 * configuration declares. A file the repository already has is kept as it is, never overwritten, so that the
 * command is safe on a repository a team set up, and may be run again. Nothing is installed nor committed:
 * the person who runs it reads what was written, then installs the dependencies and commits.
 */
export class RepositoryInit {
  private readonly options: RepositoryInitOptions;

  /** @param options - The repository, the version of Playwright and the outputs. */
  public constructor(options: RepositoryInitOptions) {
    this.options = options;
  }

  /**
   * Writes the files the repository lacks.
   *
   * @returns `0` once the files are there; `3` when the configuration is missing or invalid.
   */
  public async run(): Promise<ExitCodeValue> {
    const { repositoryRoot, playwrightVersion, write, print } = this.options;
    const path = join(repositoryRoot, CONFIG_FILE_NAME);
    const text = await readFile(path, "utf8").catch(() => undefined);
    if (text === undefined) {
      write(`${path} cannot be read; a test repository is initialised from the ${CONFIG_FILE_NAME} at its root, which declares its applications.\n`);
      return ExitCode.configuration;
    }
    const result = validateConfig(text, EVERY_VARIABLE_SET);
    if (!result.ok) {
      for (const error of result.errors) write(`${error.path || "/"}: ${error.message}\n`);
      return ExitCode.configuration;
    }
    const { applications, repository } = result.config;
    const files = testRepositoryBase({
      playwrightVersion,
      applications: applications.map(({ id, name }) => ({ id, name })),
      appsDir: repository.appsDir,
      stateDir: repository.stateDir,
    });
    const created: string[] = [];
    const kept: string[] = [];
    for (const file of files) {
      const target = join(repositoryRoot, file.path);
      const there = await stat(target).then(
        () => true,
        () => false,
      );
      if (there) kept.push(file.path);
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
        created.push(file.path);
      }
    }
    // The folder of each application exists from the start, so that the layout the README gives is the one on the disk.
    for (const { id } of applications) await mkdir(join(repositoryRoot, repository.appsDir, id), { recursive: true });
    print(`The test repository ${repositoryRoot} is a Playwright project at @playwright/test ${playwrightVersion}.\n`);
    if (created.length > 0) print(`Created: ${created.join(", ")}.\n`);
    if (kept.length > 0) print(`Kept as they were, already there: ${kept.join(", ")}.\n`);
    print(created.length === 0 ? "Nothing was missing.\n" : "Next: read what was created, run npm install, then commit it with the lockfile.\n");
    return ExitCode.passed;
  }
}
