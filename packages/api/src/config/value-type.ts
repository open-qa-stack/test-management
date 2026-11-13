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
