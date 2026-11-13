import { inspect } from "node:util";

const PROTOCOLS = new Set(["postgres:", "postgresql:"]);
const REDACTED = "[redacted database URL]";

/**
 * The connection URL of the database, a secret: it never prints itself, and it removes itself and its
 * password from any text that is about to be shown.
 */
export class DatabaseUrl {
  readonly #value: string;
  readonly #secrets: readonly string[];

  private constructor(value: string, password: string, decodedPassword: string) {
    this.#value = value;
    this.#secrets = [value, password, decodedPassword].filter((secret) => secret !== "").sort((a, b) => b.length - a.length);
    Object.freeze(this);
  }

  /**
   * @param raw - A URL with the `postgres:` or `postgresql:` scheme and a host.
   * @returns The URL, or `undefined` when the text is not one, its password included.
   */
  static parse(raw: string): DatabaseUrl | undefined {
    if (!URL.canParse(raw)) return undefined;
    const url = new URL(raw);
    if (!PROTOCOLS.has(url.protocol) || url.hostname === "") return undefined;
    try {
      return new DatabaseUrl(raw, url.password, decodeURIComponent(url.password));
    } catch {
      return undefined;
    }
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
