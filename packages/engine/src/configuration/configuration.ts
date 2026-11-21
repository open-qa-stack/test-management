import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_FILE_NAME,
  ConfigurationConflictError,
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
  type OqasConfig,
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
 * The operations on the configuration of an instance: read it, check a change, save one, and keep it in step
 * with the configuration file of the test repository. Whatever shows the configuration — a REST API, a terminal —
 * calls these and holds no rule of its own.
 *
 * @remarks
 * The store keeps the truth: the revisions of the configuration, the revision in force being the last. The file
 * stays, as the configuration kept with the tests in git: each revision bears the digest of the file it was read
 * from or wrote, which tells whether the file changed since.
 *
 * - When it is synchronised — a host starts, a session starts, a person asks for it — a file that changed becomes
 *   a revision of origin `file`, once it is valid; a file that is not leaves the revision in force as it is, and
 *   is refused with its errors.
 * - A change saved from the console becomes a revision of origin `console`, and rewrites the file in the order
 *   the schema declares its keys: the diff of the file shows what changed. The change is made from the revision
 *   in force, and refused when another replaced it since.
 * - When both changed — the file since the revision in force, and the console now — the change is refused, and
 *   nothing is merged: the person keeps the file, by synchronising it, or keeps the change, by saving it again
 *   over the file.
 *
 * The configuration is validated by the schema of the file and its rules, the environment left out: whether a
 * variable it names is set is told by the run that reads it.
 */
export class Configuration implements ConfigurationSource {
  readonly #store: ConfigurationStorePort;
  readonly #repository: string | undefined;

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
    const file = await this.#read();
    return { ...(revision === undefined ? {} : { revision }), file: fileStateOf(revision, file?.digest) };
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
   * Brings the revision in force in step with the configuration file, then gives it: a file that changed since
   * the revision in force becomes a revision of origin `file`. A file that cannot be read leaves the revision in
   * force as it is.
   *
   * @returns The revision in force.
   * @throws `NoConfigurationError` when there is neither a revision nor a file to read one from.
   * @throws `InvalidConfigurationError` when the file changed, and is not a valid configuration: the revision in
   * force stays as it is.
   */
  async synchronise(): Promise<ConfigurationRevision> {
    const inForce = await this.#store.inForce();
    const file = await this.#read();
    if (file === undefined || fileStateOf(inForce, file.digest) === "in_step") return inForce ?? this.#none();
    const read = revisionDocument(file.text);
    if (!read.ok) throw new InvalidConfigurationError(CONFIG_FILE_NAME, read.errors, inForce?.number);
    try {
      return await this.#store.record({ origin: "file", fileDigest: file.digest, document: read.document }, inForce?.number ?? 0);
    } catch (error) {
      // Another process synchronised the same file meanwhile: its revision is the one in force.
      const now = await this.#store.inForce();
      if (error instanceof StaleRevisionError && now?.fileDigest === file.digest) return now;
      throw error;
    }
  }

  /**
   * Brings the revision in force in step with the configuration file as {@link Configuration.synchronise} does, and
   * gives it, as a host does when it starts: a file the configuration refuses, or no file and no revision, leaves
   * the revision in force as it is, and the runs tell what is wrong.
   *
   * @returns The revision in force; `undefined` when there is none.
   */
  async inStep(): Promise<ConfigurationRevision | undefined> {
    try {
      return await this.synchronise();
    } catch (error) {
      if (!(error instanceof NoConfigurationError || error instanceof InvalidConfigurationError)) throw error;
      return (await this.view()).revision;
    }
  }

  /**
   * Saves a change of the configuration made in the console: it becomes a revision of origin `console`, and the
   * configuration file is rewritten with it.
   *
   * @param document - The configuration as it is to be.
   * @param basedOn - The number of the revision the change was made from; 0 when there was none.
   * @param replaceFile - Whether to rewrite a configuration file that changed since the revision in force: the
   * person chose to keep the change over the file.
   * @param origin - Where the change was made: `console` by default, `command` for a command of the terminal.
   * @returns The revision.
   * @throws {@link NoRepositoryError} when the host has no test repository whose file to rewrite.
   * @throws `InvalidConfigurationError` when the change is not a valid configuration.
   * @throws `StaleRevisionError` when the revision in force is not the one the change was made from.
   * @throws `ConfigurationConflictError` when the file changed since the revision in force, and `replaceFile` is not set.
   */
  async save(document: object, basedOn: number, replaceFile = false, origin: "console" | "command" = "console"): Promise<ConfigurationRevision> {
    const path = this.#path("The configuration cannot be changed");
    const read = revisionDocument(JSON.stringify(document));
    if (!read.ok) throw new InvalidConfigurationError("The change", read.errors);
    const inForce = await this.#store.inForce();
    const number = inForce?.number ?? 0;
    if (number !== basedOn) throw new StaleRevisionError(basedOn, number);
    if (!replaceFile && fileStateOf(inForce, (await this.#read())?.digest) === "changed") throw new ConfigurationConflictError();
    return this.#write(path, read.document, origin, basedOn);
  }

  /**
   * Writes the revision in force to the configuration file, over what the file holds: a command keeps the
   * configuration of the instance over a file that changed. The file rewritten is a revision of origin
   * `command`; a file already in step is left as it is.
   *
   * @returns The revision in force.
   * @throws {@link NoRepositoryError} when the host has no test repository whose file to write.
   * @throws `NoConfigurationError` when the instance keeps no revision.
   */
  async restore(): Promise<ConfigurationRevision> {
    const path = this.#path("The configuration file cannot be written");
    const inForce = (await this.#store.inForce()) ?? this.#none();
    if (fileStateOf(inForce, (await this.#read())?.digest) === "in_step") return inForce;
    return this.#write(path, inForce.document, "command", inForce.number);
  }

  /** Records a revision that rewrites the configuration file, the file written before the revision is kept. */
  #write(path: string, document: OqasConfig, origin: "console" | "command", basedOn: number): Promise<ConfigurationRevision> {
    const text = configurationText(document);
    return this.#store.record({ origin, fileDigest: digestOf(text), document }, basedOn, () => writeFile(path, text));
  }

  /** The configuration file of the test repository as it is now; `undefined` when there is none, or it cannot be read. */
  async #read(): Promise<ReadFile | undefined> {
    if (this.#repository === undefined) return undefined;
    const text = await readFile(join(this.#repository, CONFIG_FILE_NAME), "utf8").catch(() => undefined);
    return text === undefined ? undefined : { text, digest: digestOf(text) };
  }

  /** The path of the configuration file, for a command that writes it. */
  #path(refused: string): string {
    if (this.#repository === undefined) throw new NoRepositoryError(refused);
    return join(this.#repository, CONFIG_FILE_NAME);
  }

  /** Refuses to go on without a configuration. */
  #none(): never {
    throw new NoConfigurationError(this.#repository === undefined ? CONFIG_FILE_NAME : join(this.#repository, CONFIG_FILE_NAME));
  }
}
