import { inspect } from "node:util";

const SERVER_PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const FILE_SCHEME = "sqlite:";
const REDACTED = "[redacted database URL]";

/** The file a `sqlite:` URL names, with or without the two slashes a URL may bear before its path; `undefined` when it names none. */
function fileOf(raw: string): string | undefined {
  if (!raw.startsWith(FILE_SCHEME)) return undefined;
  const file = raw.slice(FILE_SCHEME.length).replace(/^\/\//, "");
  return file === "" ? undefined : file;
}

/**
 * The connection URL of the database, which also tells which database it is: a PostgreSQL server, or a SQLite
 * file. It is a secret: it never prints itself, and it removes itself and its password from any text that is
 * about to be shown.
 */
export class DatabaseUrl {
  /** The file of a SQLite database, `:memory:` for one kept in memory; `undefined` for a server. */
  readonly file: string | undefined;
  readonly #value: string;
  readonly #secrets: readonly string[];

  private constructor(value: string, file: string | undefined, secrets: readonly string[]) {
    this.#value = value;
    this.file = file;
    this.#secrets = secrets.filter((secret) => secret !== "").sort((a, b) => b.length - a.length);
    Object.freeze(this);
  }

  /**
   * @param raw - A URL with the `postgres:` or `postgresql:` scheme and a host, or `sqlite:` followed by the path
   * of a file, `sqlite::memory:` for a database kept in memory.
   * @returns The URL, or `undefined` when the text is not one, its password included.
   */
  static parse(raw: string): DatabaseUrl | undefined {
    const file = fileOf(raw);
    // The path of a file is no secret: an error that names it says where to look.
    if (file !== undefined) return new DatabaseUrl(raw, file, []);
    if (!URL.canParse(raw)) return undefined;
    const url = new URL(raw);
    if (!SERVER_PROTOCOLS.has(url.protocol) || url.hostname === "") return undefined;
    try {
      return new DatabaseUrl(raw, undefined, [raw, url.password, decodeURIComponent(url.password)]);
    } catch {
      return undefined;
    }
  }

  /**
   * @param file - The path of a file.
   * @returns The URL of the SQLite database that file holds.
   */
  static ofFile(file: string): DatabaseUrl {
    return new DatabaseUrl(`${FILE_SCHEME}${file}`, file, []);
  }

  /** @returns The URL itself, to hand to the database client only. */
  reveal(): string {
    return this.#value;
  }

  /**
   * @param text - A text that may hold the URL or its password, such as the message of a client error.
   * @returns The text with every occurrence of the URL and of its password replaced.
   */
  redact(text: string): string {
    return this.#secrets.reduce((redacted, secret) => redacted.replaceAll(secret, "[redacted]"), text);
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
