/**
 * Reads a JSON text.
 *
 * @param text - The text.
 * @returns The value it holds; `undefined` when it is not JSON.
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether a value read from JSON is an object with keys.
 *
 * @param value - The value.
 * @returns Whether it is an object that is neither `null` nor an array.
 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Gives a value read from JSON as a text.
 *
 * @param value - The value.
 * @returns The text itself, nothing for a value that is missing, and the JSON of anything else.
 */
export function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  return value === undefined ? "" : JSON.stringify(value);
}
