/**
 * Orders two texts by their UTF-16 code units, as a sort without a comparator does: the same order on every
 * machine, whatever its locale, such as that of the paths git lists.
 *
 * @param a - A text.
 * @param b - Another text.
 * @returns A negative number when `a` comes first, a positive one when `b` does, and `0` when they are equal.
 */
export function byCodeUnits(a: string, b: string): number {
  return Number(a > b) - Number(a < b);
}
