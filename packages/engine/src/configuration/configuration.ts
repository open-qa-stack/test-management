import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_FILE_NAME,
  configurationText,
  fileStateOf,
  InvalidConfigurationError,
  NoConfigurationError,
  revisionDocument,
  StaleRevisionError,
  type ConfigError,
  type ConfigurationRevision,
  type ConfigurationStorePort,
  type ConfigurationView,
  type FileState,
  type RevisionSummary,
} from "@open-qa-stack/domain";
import { NoRepositoryError } from "../sessions/no-repository-error.ts";
import type { ConfigurationSource } from "../ports/configuration-source.ts";

/** The configuration file of the test repository as it is now: its text, and the digest that tells it apart. */
interface ReadFile {
  readonly text: string;
  readonly digest: string;
}

/** The SHA-256 digest of a text, in hexadecimal. */
function digestOf(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Tells how the configuration file stands to the revision in force: in step when it is the file the revision was read
 * from, or the one writing the revision gives, whatever the layout of the file the revision was read from.
 */
function stateOf(inForce: ConfigurationRevision | undefined, file: ReadFile | undefined): FileState {
  const state = fileStateOf(inForce, file?.digest);
  // A file that differs was read.
  return state === "changed" && inForce !== undefined && file!.digest === digestOf(configurationText(inForce.document)) ? "in_step" : state;
}

/**
 * The operations on the configuration of an instance: read it, check a change, save one, and take or write the
 * configuration file of the test repository. Whatever shows the configuration — a REST API, a terminal — calls these
 * and holds no rule of its own.
 *
 * @remarks
 * The store is the one source of the configuration: its revisions, the revision in force being the last. The file is
 * a copy, kept with the tests in git or written for the continuous integration; each revision bears the digest of
 * the file that would hold it, which tells whether the file differs from it.
 *
 * - An instance that keeps no revision yet takes the file as its first, of origin `file`, once it is valid.
 * - Otherwise the file is read only when a person asks for it to be taken: a file that differs then becomes a
 *   revision of origin `file`, once it is valid; one that is not is refused with its errors.
 * - A change saved from the console or a command becomes a revision of origin `console` or `command`, made from the
 *   revision in force, and refused when another replaced it since. It writes no file: the file is written when a
 *   person asks for it, in the order the schema declares its keys.
 *
 * The configuration is validated by the schema of the file and its rules, the environment left out: whether a
 * variable it names is set is told by the run that reads it.
 */
export class Configuration implements ConfigurationSource {
  readonly #store: ConfigurationStorePort;
  readonly #repository: string | undefined;
  /** What is told each revision this instance records. */
  readonly #listeners: ((revision: ConfigurationRevision) => void)[] = [];

  /**
   * @param store - The store of the revisions.
   * @param repository - Absolute path of the test repository, the folder that holds the configuration file;
   * `undefined` for a host that has none, which reads the revisions and changes none.
   */
  constructor(store: ConfigurationStorePort, repository: string | undefined) {
    this.#store = store;
    this.#repository = repository;
  }

  /** @returns The revision in force, and how the configuration file stands to it. Nothing is written. */
  async view(): Promise<ConfigurationView> {
    const revision = await this.#store.inForce();
    return { ...(revision === undefined ? {} : { revision }), file: stateOf(revision, await this.#read()) };
  }

  /** @returns Every revision, without its document, the latest first. */
  revisions(): Promise<RevisionSummary[]> {
    return this.#store.revisions();
  }

  /**
   * Validates a configuration, without recording anything.
   *
   * @param document - The configuration, as JSON reads it.
   * @returns Every error found, each where it is; none when it is valid.
   */
  check(document: object): ConfigError[] {
    const read = revisionDocument(JSON.stringify(document));
    return read.ok ? [] : read.errors;
  }

  /**
   * @returns The revision in force; an instance that keeps none yet takes the configuration file as its first, of origin `file`.
   * @throws `NoConfigurationError` when there is neither a revision nor a file to read one from.
   * @throws `InvalidConfigurationError` when the instance keeps no revision, and the file is not a valid configuration.
   */
  async current(): Promise<ConfigurationRevision> {
    return (await this.#store.inForce()) ?? this.synchronise();
  }

  /**
   * Takes the configuration file as the revision in force, when it differs from it: it becomes a revision of origin
   * `file`. A file that cannot be read leaves the revision in force as it is.
   *
   * @returns The revision in force.
   * @throws `NoConfigurationError` when there is neither a revision nor a file to read one from.
   * @throws `InvalidConfigurationError` when the file differs, and is not a valid configuration: the revision in
   * force stays as it is.
   */
  async synchronise(): Promise<ConfigurationRevision> {
    const inForce = await this.#store.inForce();
    const file = await this.#read();
    if (file === undefined || stateOf(inForce, file) === "in_step") return inForce ?? this.#none();
    const read = revisionDocument(file.text);
    if (!read.ok) throw new InvalidConfigurationError(CONFIG_FILE_NAME, read.errors, inForce?.number);
    try {
      return this.#told(await this.#store.record({ origin: "file", fileDigest: file.digest, document: read.document }, inForce?.number ?? 0));
    } catch (error) {
      // Another process synchronised the same file meanwhile: its revision is the one in force.
      const now = await this.#store.inForce();
      if (error instanceof StaleRevisionError && now?.fileDigest === file.digest) return now;
      throw error;
    }
  }

  /**
   * Gives the revision in force as {@link Configuration.current} does, as a host does when it starts: a first file the
   * configuration refuses, or no file and no revision, leaves the instance without one, and the runs tell what is wrong.
   *
   * @returns The revision in force; `undefined` when there is none.
   */
  async inForce(): Promise<ConfigurationRevision | undefined> {
    try {
      return await this.current();
    } catch (error) {
      if (!(error instanceof NoConfigurationError || error instanceof InvalidConfigurationError)) throw error;
      return undefined;
    }
  }

  /**
   * Saves a change of the configuration: it becomes a revision of origin `console`, or `command` for a command of the
   * terminal. No file is written.
   *
   * @param document - The configuration as it is to be.
   * @param basedOn - The number of the revision the change was made from; 0 when there was none.
   * @param origin - Where the change was made: `console` by default, `command` for a command of the terminal.
   * @returns The revision.
   * @throws `InvalidConfigurationError` when the change is not a valid configuration.
   * @throws `StaleRevisionError` when the revision in force is not the one the change was made from.
   */
  async save(document: object, basedOn: number, origin: "console" | "command" = "console"): Promise<ConfigurationRevision> {
    const read = revisionDocument(JSON.stringify(document));
    if (!read.ok) throw new InvalidConfigurationError("The change", read.errors);
    const number = (await this.#store.inForce())?.number ?? 0;
    if (number !== basedOn) throw new StaleRevisionError(basedOn, number);
    const text = configurationText(read.document);
    return this.#told(await this.#store.record({ origin, fileDigest: digestOf(text), document: read.document }, basedOn));
  }

  /**
   * Writes the revision in force to the configuration file, over what the file holds, in the order the schema
   * declares its keys. A file that already holds it is left as it is; the revision in force does not change.
   *
   * @returns The revision in force.
   * @throws {@link NoRepositoryError} when the host has no test repository whose file to write.
   * @throws `NoConfigurationError` when the instance keeps no revision.
   */
  async restore(): Promise<ConfigurationRevision> {
    if (this.#repository === undefined) throw new NoRepositoryError("The configuration file cannot be written");
    const inForce = (await this.#store.inForce()) ?? this.#none();
    const text = configurationText(inForce.document);
    if ((await this.#read())?.digest !== digestOf(text)) await writeFile(join(this.#repository, CONFIG_FILE_NAME), text);
    return inForce;
  }

  /**
   * Tells a listener each revision this instance records from now on — a change saved, a file taken or written —, as
   * a host that maps the knowledge of a source added needs. A revision another process recorded is not told.
   *
   * @param listener - What is told the revision, once it is recorded.
   */
  whenRecorded(listener: (revision: ConfigurationRevision) => void): void {
    this.#listeners.push(listener);
  }

  /** Tells each listener a revision recorded, and gives it back. */
  #told(revision: ConfigurationRevision): ConfigurationRevision {
    for (const listener of this.#listeners) listener(revision);
    return revision;
  }

  /** The configuration file of the test repository as it is now; `undefined` when there is none, or it cannot be read. */
  async #read(): Promise<ReadFile | undefined> {
    if (this.#repository === undefined) return undefined;
    const text = await readFile(join(this.#repository, CONFIG_FILE_NAME), "utf8").catch(() => undefined);
    return text === undefined ? undefined : { text, digest: digestOf(text) };
  }

  /** Refuses to go on without a configuration. */
  #none(): never {
    throw new NoConfigurationError(this.#repository === undefined ? CONFIG_FILE_NAME : join(this.#repository, CONFIG_FILE_NAME));
  }
}
