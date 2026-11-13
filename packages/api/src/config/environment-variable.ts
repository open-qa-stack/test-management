import type { ValueType } from "./value-type.ts";

/** Variables of a process environment, usually `process.env`. */
export type Environment = Readonly<Record<string, string | undefined>>;

/** A variable the API reads once, at startup. */
export interface EnvironmentVariable<T> {
  readonly name: string;
  readonly description: string;
  readonly type: ValueType<T>;
  /** A secret value never appears in a log, an error message or a response. */
  readonly secret: boolean;
  /** Raw value used when the variable is unset; a variable without one is required. */
  readonly defaultValue?: string;
  readonly example: string;
}
