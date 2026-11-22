import { declaredSecrets, SecretRefusedError, UnknownSecretError, type SecretState } from "@open-qa-stack/domain";
import { NoRepositoryError } from "../sessions/no-repository-error.ts";
import type { Configuration } from "../configuration/configuration.ts";
import type { Environment, EnvironmentSource } from "../ports/environment-source.ts";
import type { SecretStore } from "../ports/secret-store.ts";

/** @returns Whether a variable is set, to a value that is not empty. */
function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

/**
 * The operations on the values of the variables the configuration names — the key of the model, the connection
 * strings of the databases, the accounts of the tests: list them, save one. Whatever asks for them — the console, a
 * terminal, a command — calls these and holds no rule of its own; no operation gives a value back. A value saved is
 * replaced by saving another.
 *
 * @remarks
 * A value saved is kept out of the test repository, on this machine; the environment of the process wins over it, as
 * in a CI, which sets its variables and saves nothing. The environment the runs read is that of the process completed
 * with the values saved, read again each time: a value another process saved — a console, a command in another
 * terminal — is read by the next run.
 */
export class Secrets implements EnvironmentSource {
  readonly #configuration: Configuration;
  readonly #process: Environment;
  readonly #store: SecretStore | undefined;

  /**
   * @param configuration - The operations on the configuration, whose revision in force names the variables.
   * @param process - The environment of the process.
   * @param store - Where the values given are kept; `undefined` for a host without a test repository, which saves none.
   */
  constructor(configuration: Configuration, process: Environment, store?: SecretStore) {
    this.#configuration = configuration;
    this.#process = process;
    this.#store = store;
  }

  /**
   * @returns The environment the runs read: that of the process, completed with the values saved.
   * @throws When the values kept cannot be read.
   */
  async current(): Promise<Environment> {
    const set = Object.entries(this.#process).filter(([, value]) => isSet(value));
    return { ...(await this.#saved()), ...Object.fromEntries(set) };
  }

  /**
   * @returns Each variable the configuration in force names, and where its value comes from; none without a configuration.
   * @throws When the values kept cannot be read.
   */
  async list(): Promise<SecretState[]> {
    const revision = await this.#configuration.inForce();
    if (revision === undefined) return [];
    const saved = await this.#saved();
    return declaredSecrets(revision.document).map((secret) => ({
      ...secret,
      source: isSet(this.#process[secret.name]) ? "environment" : Object.hasOwn(saved, secret.name) ? "saved" : "missing",
    }));
  }

  /**
   * Saves the value of a variable the configuration in force names, in place of the one saved.
   *
   * @param name - The name of the variable.
   * @param value - Its value.
   * @throws `UnknownSecretError` when the configuration in force names no such variable.
   * @throws `SecretRefusedError` when the value is empty, or the environment of the process sets the variable.
   * @throws {@link NoRepositoryError} when the host has no test repository to keep it for.
   */
  async save(name: string, value: string): Promise<void> {
    if (!(await this.list()).some((secret) => secret.name === name)) throw new UnknownSecretError(name);
    if (value === "") throw new SecretRefusedError(`The value of ${name} is empty: give one.`);
    if (isSet(this.#process[name]))
      throw new SecretRefusedError(
        `${name} is set in the environment of the process, which wins over a value saved: change it there, or start oqas without it.`,
      );
    if (this.#store === undefined) throw new NoRepositoryError("No value can be saved");
    await this.#store.write({ ...(await this.#store.read()), [name]: value });
  }

  /** @returns The values kept; none for a host without a test repository. */
  #saved(): Promise<Record<string, string>> {
    return this.#store === undefined ? Promise.resolve({}) : this.#store.read();
  }
}
