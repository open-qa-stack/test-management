import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { testRepositoryBase } from "@open-qa-stack/harness";
import { ExitCode, resolvedConfig, type ConfigurationRevision, type ExitCodeValue } from "@open-qa-stack/domain";
import type { ConfigurationSource } from "@open-qa-stack/engine";
import { configurationRefusal } from "./configuration-lines.ts";

/** What the initialisation of a test repository needs. */
export interface RepositoryInitOptions {
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Where the configuration is read: the revision in force, once it is in step with the configuration file. */
  readonly configuration: ConfigurationSource;
  /** The exact version of `@playwright/test` the repository is initialised at. */
  readonly playwrightVersion: string;
  /** Writes a line of what went wrong. */
  readonly write: (line: string) => void;
  /** Prints a line of what was done. */
  readonly print: (line: string) => void;
}

/**
 * Initialises a test repository as a Playwright project, from the configuration in force, once it is in step with
 * its file: the instance takes the file as its first revision when it has none.
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
   * @throws What the store of the configuration raises when it cannot be read or written.
   */
  public async run(): Promise<ExitCodeValue> {
    const { repositoryRoot, playwrightVersion, write, print } = this.options;
    const revision = await this.options.configuration.synchronise().catch((error: unknown) => refused(write, error));
    if (revision === undefined) return ExitCode.configuration;
    const { applications, repository, design } = resolvedConfig(revision.document);
    const files = testRepositoryBase({
      playwrightVersion,
      applications: applications.map(({ id, name, type }) => ({ id, name, ui: type !== "api" })),
      appsDir: repository.appsDir,
      stateDir: repository.stateDir,
      // Tests that each stand alone share no fixtures: nothing is written for them.
      ...(design.architecture === "standalone" ? {} : { fixturesFile: design.fixturesFile }),
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

/**
 * Tells why the configuration cannot be had, and what to do.
 *
 * @returns Nothing, once it is told.
 * @throws The error, when it is no refusal of the configuration.
 */
function refused(write: (line: string) => void, error: unknown): ConfigurationRevision | undefined {
  const told = configurationRefusal(error);
  if (told === undefined) throw error;
  write(`${told}\n`);
  return undefined;
}
