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
  /** Raw value used when the variable is unset; a variable without one is required, unless it is optional. */
  readonly defaultValue?: string;
  /** Whether the variable may be left unset, and then has no value: the API starts without what it sets. */
  readonly optional?: boolean;
  /** The name of the variable that stands in for this one when it is left unset: one of the two must be set. */
  readonly orElse?: string;
  readonly example: string;
}
