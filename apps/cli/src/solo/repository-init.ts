import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import { RepositorySetup, type ConfigurationSource } from "@open-qa-stack/engine";
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
 * `oqas --init`: initialises a test repository as a Playwright project, from the configuration in force, with the
 * operation of the engine every presentation calls.
 *
 * @remarks
 * A file the repository already has is kept as it is, never overwritten, so that the command is safe on a repository
 * a team set up, and may be run again. A folder that is no git repository yet is made one, and what was written is
 * committed; in a git repository that exists, nothing is committed: the person reads what was written, then commits.
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
   * @throws What the store of the configuration raises when it cannot be read or written, and what git raises.
   */
  public async run(): Promise<ExitCodeValue> {
    const { repositoryRoot, configuration, playwrightVersion, write, print } = this.options;
    let done;
    try {
      done = await new RepositorySetup(repositoryRoot, configuration, playwrightVersion).prepare();
    } catch (error) {
      const told = configurationRefusal(error);
      if (told === undefined) throw error;
      write(`${told}\n`);
      return ExitCode.configuration;
    }
    const { created, kept, committed } = done;
    print(`The test repository ${repositoryRoot} is a Playwright project at @playwright/test ${playwrightVersion}.\n`);
    if (created.length > 0) print(`Created: ${created.join(", ")}.\n`);
    if (kept.length > 0) print(`Kept as they were, already there: ${kept.join(", ")}.\n`);
    if (committed) print("The folder was no git repository: it is one now, and what was created is committed. Next: run npm install.\n");
    else print(created.length === 0 ? "Nothing was missing.\n" : "Next: read what was created, run npm install, then commit it with the lockfile.\n");
    return ExitCode.passed;
  }
}
