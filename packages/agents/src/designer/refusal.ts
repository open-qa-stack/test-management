import type { Journal } from "../common/journal.ts";

/** One reason a gate of the harness refuses a call. */
export interface Refusal {
  /** The code of the gate, such as `PLAN-ID`, by which a trial is scored. */
  readonly code: string;
  /** What is wrong and what to do, in sentences the agent can act on. */
  readonly message: string;
  /** What the gate would accept, told alone once it refused the same reason three times; the message alone when none is given. */
  readonly remedy?: string;
}

/** How the refusal of a reason the agent was refused for twice already starts, by how many times it was refused. */
const REPEATED = new Map([
  [3, "Third"],
  [4, "Fourth"],
  [5, "Fifth"],
]);

/**
 * What the agent is told of a refusal: every reason, one line each, with its code, then a line that says
 * nothing else was refused, so that it fixes all of them at once.
 *
 * @param refusals - The reasons, at least one.
 * @returns The text of the refusal.
 */
export function refusalText(refusals: readonly Refusal[]): string {
  return [...refusals.map(({ code, message }) => `Refused (${code}): ${message}`), "Nothing else was refused."].join("\n");
}

/**
 * What the agent is told of a reason it was refused for three times or more: only what the gate would
 * accept, from each refusal of that code, or the first of them when they give nothing else.
 *
 * @param code - The code refused again.
 * @param times - How many times it was refused, three to five.
 * @param refusals - The reasons of the refusal, one of them at least of that code.
 * @returns The text of the refusal.
 */
export function repeatedText(code: string, times: number, refusals: readonly Refusal[]): string {
  const same = refusals.filter((refusal) => refusal.code === code);
  const remedies = [...new Set(same.flatMap((refusal) => (refusal.remedy === undefined ? [] : [refusal.remedy])))];
  const told = remedies.length === 0 ? [`Refused (${code}): ${same[0]!.message}`] : remedies;
  return [`${REPEATED.get(times)} refusal for the same reason. Do this:`, ...told].join("\n");
}

/**
 * The reasons of a refusal with every declared value masked, in what they say and in what they would accept.
 *
 * @param refusals - The reasons.
 * @param mask - Masks the declared values of a text.
 * @returns The reasons masked.
 */
export function maskedRefusals(refusals: readonly Refusal[], mask: (text: string) => string): Refusal[] {
  return refusals.map((refusal) => ({ ...refusal, message: mask(refusal.message), ...(refusal.remedy === undefined ? {} : { remedy: mask(refusal.remedy) }) }));
}

/**
 * Journals each reason of a refusal, with its code first.
 *
 * @param journal - The journal.
 * @param what - What was refused, such as `The plan was refused by the harness`.
 * @param refusals - The reasons.
 */
export function journalRefusals(journal: Journal, what: string, refusals: readonly Refusal[]): void {
  for (const { code, message } of refusals) journal.record("error", `[${code}] ${what}: ${message}`);
}
