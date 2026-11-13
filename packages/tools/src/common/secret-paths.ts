import { redactText } from "../browser/redact.ts";

/**
 * Finds the strings of a value that hold a secret.
 *
 * @param value - A value an agent wrote: a note, a card, an index.
 * @param forms - The secrets, in every form `secretForms` gives.
 * @param path - JSON Pointer of `value` itself; the whole value by default.
 * @returns The JSON Pointer of each string that holds one, in the order of the value.
 */
export function secretPaths(value: unknown, forms: readonly string[], path = ""): string[] {
  if (typeof value === "string") return redactText(value, forms) === value ? [] : [path];
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, item]) => secretPaths(item, forms, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`));
}
