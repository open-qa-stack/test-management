/** What a step of a scenario does and expects, as a test would. */
export interface VerifiedStep {
  /** The lines of code that do the step; the sentence of its action when the harness wrote no code for it. */
  readonly does: readonly string[];
  /** The texts the step expects shown. */
  readonly shows: readonly string[];
  /** The texts the step expects gone. */
  readonly absent: readonly string[];
}

/** What a scenario does and verifies, whatever its title and its intent say. */
export interface Verified {
  /** Identifier of its application. */
  readonly application: string;
  /** The values its test enters. */
  readonly data: readonly string[];
  /** Its steps, in order. */
  readonly steps: readonly VerifiedStep[];
}

/** A text as two scenarios are compared by it: its spaces collapsed. */
const flat = (text: string) => text.replace(/\s+/g, " ").trim();
/** The texts of a list, as a set compares them. */
const set = (texts: readonly string[]) => new Set(texts.map(flat));
/** Whether every text of a list is one of another. */
const within = (texts: readonly string[], others: readonly string[]) => {
  const held = set(others);
  return [...set(texts)].every((text) => held.has(text));
};

/**
 * Whether a scenario verifies nothing another does not: the first guard against duplicates, by the code.
 *
 * @remarks
 * Two scenarios are compared by what their tests would do, not by their words: the same application, the
 * same values entered, the same steps done the same way, and no text expected that the other does not
 * expect at the same step. A scenario that does the same and expects less is covered as well as one that
 * expects the same.
 *
 * @param scenario - The scenario submitted.
 * @param other - A scenario already kept.
 * @returns `true` when `other` already verifies everything `scenario` does.
 */
export function coveredBy(scenario: Verified, other: Verified): boolean {
  if (scenario.application !== other.application || scenario.steps.length !== other.steps.length) return false;
  if (!within(scenario.data, other.data) || !within(other.data, scenario.data)) return false;
  return scenario.steps.every((step, at) => {
    const kept = other.steps[at]!;
    return step.does.map(flat).join("\n") === kept.does.map(flat).join("\n") && within(step.shows, kept.shows) && within(step.absent, kept.absent);
  });
}
