/** Fewest characters a text needs to be checked: a shorter one matches too much by chance. */
const SHORTEST_CHECKED = 3;

/**
 * Whether a text is long enough for a gate to check it.
 *
 * @param text - The text.
 * @returns `true` when it holds three characters or more, spaces collapsed.
 */
export function checkable(text: string): boolean {
  return folded(text).length >= SHORTEST_CHECKED;
}

/**
 * Whether a text was observed in what the tools returned: spaces collapsed and case aside, it is part of one
 * of their texts. Every gate that asks whether something was seen or read asks it this way.
 *
 * @param text - The text looked for.
 * @param texts - What the tools returned, such as the lines of the snapshots.
 * @returns `true` when one of them holds it.
 */
export function observed(text: string, texts: Iterable<string>): boolean {
  const looked = folded(text);
  for (const candidate of texts) if (folded(candidate).includes(looked)) return true;
  return false;
}

/**
 * Whether a text was observed whole in what the tools returned: as `observed` says, and with no letter nor digit
 * right before it or right after it, so that a value is not taken for part of a longer one, as 300 in 3000.
 *
 * @param text - The text looked for.
 * @param texts - What the tools returned.
 * @returns `true` when one of them holds it whole.
 */
export function observedWhole(text: string, texts: Iterable<string>): boolean {
  const looked = folded(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const whole = new RegExp(`(?<![\\p{L}\\p{N}])${looked}(?![\\p{L}\\p{N}])`, "u");
  for (const candidate of texts) if (whole.test(folded(candidate))) return true;
  return false;
}

/**
 * Whether two texts are the same, spaces collapsed and case aside.
 *
 * @param text - A text.
 * @param other - Another.
 * @returns `true` when they are.
 */
export function sameText(text: string, other: string): boolean {
  return folded(text) === folded(other);
}

/** A text with its spaces collapsed, in lower case. */
function folded(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
