/** Where a test repository stands: whether it is a git repository, with a commit, and a Playwright project. */
export interface RepositoryState {
  /** Absolute path of the folder of the test repository, on the machine of the instance: where the project is written. */
  readonly folder: string;
  /** `none`: the folder is no git repository; `empty`: it is one without a commit; `ready`: it has a commit. */
  readonly git: "none" | "empty" | "ready";
  /** Whether it is a Playwright project: it has its `playwright.config.ts`. */
  readonly playwright: boolean;
}

/** What preparing a test repository did. */
export interface RepositoryPreparation {
  /** The files it wrote, which the repository lacked. */
  readonly created: readonly string[];
  /** The files the repository had already, kept as they were. */
  readonly kept: readonly string[];
  /** Whether it made the folder a git repository, and committed what it wrote with the configuration file. */
  readonly committed: boolean;
}
