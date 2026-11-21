import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE_NAME, declaredStateDir, isRecord, parseJson } from "@open-qa-stack/domain";
import type { SecretStore } from "../ports/secret-store.ts";

/** The folder of the state folder of a test repository that holds the values, and ignores itself in git. */
export const SECRETS_FOLDER = "secrets";

/** The file of that folder that holds them. */
const VALUES_FILE = "values.json";

/**
 * Keeps the values of the variables in a file of the state folder of the test repository that only its owner reads,
 * in a folder whose own `.gitignore` leaves all of it out of git, whatever the `.gitignore` of the repository says.
 */
export class FileSecretStore implements SecretStore {
  readonly #folder: string;

  /** @param folder - Absolute path of the folder that holds the values. */
  constructor(folder: string) {
    this.#folder = folder;
  }

  /**
   * @param repository - Absolute path of the test repository.
   * @returns The store of the values of that repository, in the state folder its configuration file names, or the default one.
   */
  static of(repository: string): FileSecretStore {
    let content = "";
    try {
      content = readFileSync(join(repository, CONFIG_FILE_NAME), "utf8");
    } catch {
      // No file yet: the state folder is the default one, as for the database.
    }
    return new FileSecretStore(join(repository, declaredStateDir(content), SECRETS_FOLDER));
  }

  async read(): Promise<Record<string, string>> {
    const path = join(this.#folder, VALUES_FILE);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    const values = parseJson(text);
    if (!isRecord(values) || Object.values(values).some((value) => typeof value !== "string"))
      throw new Error(`${path} cannot be read: it holds the values saved for the variables of the configuration. Remove it, and give them again.`);
    return values as Record<string, string>;
  }

  async write(values: Readonly<Record<string, string>>): Promise<void> {
    await mkdir(this.#folder, { recursive: true, mode: 0o700 });
    await writeFile(join(this.#folder, ".gitignore"), "*\n");
    const path = join(this.#folder, VALUES_FILE);
    const next = `${path}.next`;
    await writeFile(next, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
    await chmod(next, 0o600);
    await rename(next, path);
  }
}
