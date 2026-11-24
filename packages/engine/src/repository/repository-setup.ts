import { execFile } from "node:child_process";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { CONFIG_FILE_NAME, resolvedConfig, type OqasConfig, type RepositoryPreparation, type RepositoryState } from "@open-qa-stack/domain";
import { testRepositoryBase } from "@open-qa-stack/harness";
import { playwrightVersion } from "@open-qa-stack/tools";
import type { ConfigurationSource } from "../ports/configuration-source.ts";
import { NoRepositoryError } from "../sessions/no-repository-error.ts";

/** The message of the commit that records a test repository the setup made. */
export const SETUP_COMMIT = "chore: set up the test repository";

/** Who signs the commit of the setup on a machine where git knows nobody: the person may amend it afterwards. */
const SETUP_AUTHOR = ["-c", "user.name=Open QA Stack", "-c", "user.email=oqas@localhost"];

/**
 * The operation that makes a Playwright project of a test repository, from the configuration in force: whatever
 * starts a test repository — `oqas --init`, the first use of the console — calls it and holds no rule of its own.
 *
 * @remarks
 * It is a program, not an agent: it calls no model and installs nothing. The files are those `testRepositoryBase`
 * gives for the applications of the configuration; a file the repository already has is kept as it is, never
 * overwritten. A folder that is no git repository yet is made one, and what was written is committed with the
 * configuration file, so that a session may start at once — by the identity git knows on the machine, or by Open QA
 * Stack when it knows none; in a git repository that exists, nothing is committed: its history belongs to the person.
 */
export class RepositorySetup {
  readonly #given: string | undefined;
  readonly #configuration: ConfigurationSource;
  readonly #version: string;

  /**
   * @param root - Absolute path of the test repository; `undefined` for a host that was given none, which sets nothing up.
   * @param configuration - What brings the configuration in force in step with its file.
   * @param version - The version of `@playwright/test` the project pins; that of the tools by default.
   */
  constructor(root: string | undefined, configuration: ConfigurationSource, version: string = playwrightVersion()) {
    this.#given = root;
    this.#configuration = configuration;
    this.#version = version;
  }

  /** The test repository; {@link NoRepositoryError} for a host that was given none. */
  get #root(): string {
    if (this.#given === undefined) throw new NoRepositoryError("The test repository cannot be set up");
    return this.#given;
  }

  /**
   * @returns Where the test repository stands: its folder, whether it is a git repository, and a Playwright project.
   * @throws {@link NoRepositoryError} when the host was given no test repository.
   */
  async state(): Promise<RepositoryState> {
    return { folder: this.#root, git: await this.#git(), playwright: await exists(join(this.#root, "playwright.config.ts")) };
  }

  /**
   * Writes what the test repository lacks to be a Playwright project for the applications of the configuration in
   * force, and makes the folder a git repository, with a commit, when it is none.
   *
   * @returns What it wrote, what it kept, and whether it committed.
   * @throws What reading the configuration in force raises: `NoConfigurationError`, `InvalidConfigurationError`.
   * @throws The error of git when the folder cannot be made a repository or the commit cannot be made.
   * @throws {@link NoRepositoryError} when the host was given no test repository.
   */
  async prepare(): Promise<RepositoryPreparation> {
    // A host without a test repository is refused before anything is read.
    void this.#root;
    const revision = await this.#configuration.current();
    const fresh = (await this.#git()) === "none";
    const { created, kept } = await this.#write(revision.document);
    if (!fresh) return { created, kept, committed: false };
    await this.#run("init", "--quiet");
    // The configuration lives in the instance: its file is committed with the project when a person wrote it.
    const copy = (await exists(join(this.#root, CONFIG_FILE_NAME))) ? [CONFIG_FILE_NAME] : [];
    await this.#run("add", "--", ...copy, ...created);
    const known = (await this.#run("config", "user.email").catch(() => "")).trim() !== "";
    await this.#run(...(known ? [] : SETUP_AUTHOR), "commit", "--quiet", "--message", SETUP_COMMIT);
    return { created, kept, committed: true };
  }

  /** Writes the files of the project the repository lacks, and the folder of each application. */
  async #write(document: OqasConfig): Promise<{ created: string[]; kept: string[] }> {
    const { applications, repository, design } = resolvedConfig(document);
    const files = testRepositoryBase({
      playwrightVersion: this.#version,
      applications: applications.map(({ id, name, type }) => ({ id, name, ui: type !== "api" })),
      appsDir: repository.appsDir,
      stateDir: repository.stateDir,
      // Tests that each stand alone share no fixtures: nothing is written for them.
      ...(design.architecture === "standalone" ? {} : { fixturesFile: design.fixturesFile }),
      pageObjects: design.architecture === "page-objects",
    });
    const created: string[] = [];
    const kept: string[] = [];
    for (const file of files) {
      const target = join(this.#root, file.path);
      if (await exists(target)) kept.push(file.path);
      else {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.content);
        created.push(file.path);
      }
    }
    // The folder of each application exists from the start, so that the layout the README gives is the one on the disk.
    for (const { id } of applications) await mkdir(join(this.#root, repository.appsDir, id), { recursive: true });
    return { created, kept };
  }

  /** Whether the folder is the root of a git repository, and has a commit. */
  async #git(): Promise<RepositoryState["git"]> {
    const top = await this.#run("rev-parse", "--show-toplevel").catch(() => undefined);
    if (top === undefined || !(await sameFolder(top.trim(), this.#root))) return "none";
    return (await this.#run("rev-parse", "--verify", "--quiet", "HEAD").catch(() => undefined)) === undefined ? "empty" : "ready";
  }

  /** Runs git in the test repository. */
  #run(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) =>
      // The error of git names the command and holds what git wrote on its error output.
      execFile("git", args, { cwd: this.#root }, (error, stdout) => (error === null ? resolve(stdout) : reject(error))),
    );
  }
}

/** Whether a path exists. */
function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Whether two paths name the same folder, whatever their links. */
async function sameFolder(a: string, b: string): Promise<boolean> {
  return (await realpath(a)) === (await realpath(b));
}
