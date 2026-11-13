import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import { pointer } from "../config/errors.ts";
import type { IndexError, IndexValidation } from "./types.ts";

/**
 * Validates a value against a compiled schema, then against rules that span the document.
 *
 * @param check - The compiled schema.
 * @param value - The value.
 * @param rules - The rules, run once the schema holds.
 * @returns The value, or every error found.
 */
export function validate<T>(check: ValidateFunction<T>, value: unknown, rules: (valid: T) => IndexError[]): IndexValidation<T> {
  if (!check(value)) return { ok: false, errors: check.errors!.map(schemaError) };
  const errors = rules(value);
  return errors.length === 0 ? { ok: true, value } : { ok: false, errors };
}

/**
 * Lists the values given more than once.
 *
 * @param values - The identifiers, in the order of the list that holds them.
 * @param list - JSON Pointer of that list.
 * @param key - Key of the identifier in each entry.
 * @param what - What an entry is, for the message.
 * @returns An error for each repetition, at its location.
 */
export function repeated(values: readonly string[], list: string, key: string, what: string): IndexError[] {
  const seen = new Set<string>();
  return values.flatMap((value, i) => {
    const again = seen.has(value);
    seen.add(value);
    return again ? [{ path: `${list}/${i}/${key}`, message: `${list}/${i}/${key} repeats the ${what} ${value}.` }] : [];
  });
}

/** An Ajv error as a located message that names the field in fault. */
function schemaError(error: ErrorObject): IndexError {
  const named = error.keyword === "required" || error.keyword === "additionalProperties" ? pointer(error.instancePath, String(Object.values(error.params)[0])) : error.instancePath;
  const message = error.keyword === "additionalProperties" ? `${named} is not allowed.` : `${error.instancePath === "" ? "The document" : error.instancePath} ${String(error.message)}.`;
  return { path: named, message };
}
