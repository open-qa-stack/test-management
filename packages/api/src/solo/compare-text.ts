/**
 * Orders two texts by their characters, the same on every machine: dates written in one ISO 8601 form sort in time.
 *
 * @param a - A text.
 * @param b - Another.
 * @returns A negative number when the first comes first, a positive one when the second does, zero when they are equal.
 */
export function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
