import { isAbsolute } from "node:path";
import { type CommandLine, splitCommandLine } from "./command-line.ts";
import { DatabaseUrl } from "./database-url.ts";

const PORT_DIGITS = /^[0-9]{1,5}$/;

/** Outcome of reading the raw value of a variable. */
export type ParsedValue<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

/** How the raw value of an environment variable is read. */
export interface ValueType<T> {
  /** The rule a raw value follows, phrased to complete "must be": `an integer from 1 to 65535`. */
  readonly rule: string;
  /** Reads a raw value; never echoes it back on failure. */
  parse(raw: string): ParsedValue<T>;
}

/** A TCP port: an integer from 1 to 65535, written in decimal digits only. */
export const portNumber: ValueType<number> = {
  rule: "an integer from 1 to 65535",
  parse(raw) {
    const value = Number(raw);
    return PORT_DIGITS.test(raw) && value >= 1 && value <= 65535 ? { ok: true, value } : { ok: false };
  },
};

/** Any text that is not empty. */
export const nonEmptyText: ValueType<string> = {
  rule: "a text that is not empty",
  parse(raw) {
    return raw === "" ? { ok: false } : { ok: true, value: raw };
  },
};

/** A PostgreSQL connection URL, such as `postgres://user:password@host:5432/database`. */
export const databaseUrl: ValueType<DatabaseUrl> = {
  rule: "a PostgreSQL connection URL with a host name, starting with postgres:// or postgresql://",
  parse(raw) {
    const value = DatabaseUrl.parse(raw);
    return value === undefined ? { ok: false } : { ok: true, value };
  },
};

/** The absolute path of a file or of a folder. */
export const absolutePath: ValueType<string> = {
  rule: "an absolute path",
  parse(raw) {
    return isAbsolute(raw) ? { ok: true, value: raw } : { ok: false };
  },
};

/** A command: its program, then its arguments, split by {@link splitCommandLine}. */
export const commandLine: ValueType<CommandLine> = {
  rule: "a program and its arguments, separated by spaces, one that holds a space between quotes",
  parse(raw) {
    const value = splitCommandLine(raw);
    return value === undefined ? { ok: false } : { ok: true, value };
  },
};
