/** The last moment taken. */
let last = 0;

/**
 * The moment of something a watch saw, such as a value in a field or a text a source returned: it comes after
 * every moment taken before it, by any watch, so that what the screens and the sources showed is ordered.
 *
 * @returns The moment.
 */
export function nextMoment(): number {
  last += 1;
  return last;
}
