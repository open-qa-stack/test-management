import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { CONFIG_FILE_NAME } from "@open-qa-stack/domain";
import { DatabaseUrl } from "@open-qa-stack/store";

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

/** The connection URL of a database the store supports: a PostgreSQL server, or a SQLite file. */
export const databaseUrl: ValueType<DatabaseUrl> = {
  rule: DatabaseUrl.rule,
  parse(raw) {
    const value = DatabaseUrl.parse(raw);
    return value === undefined ? { ok: false } : { ok: true, value };
  },
};

/** A test repository: the absolute path of a folder that holds the configuration of Open QA Stack. */
export const testRepository: ValueType<string> = {
  rule: `the absolute path of a folder that holds ${CONFIG_FILE_NAME}`,
  parse(raw) {
    return isAbsolute(raw) && existsSync(join(raw, CONFIG_FILE_NAME)) ? { ok: true, value: raw } : { ok: false };
  },
};
