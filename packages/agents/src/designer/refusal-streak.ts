import type { Refusal } from "./refusal.ts";

/** Refusals of one reason from which the agent is told only what the gate would accept. */
export const GUIDED_REFUSALS = 3;
/** Refusals of one reason that close a scenario. */
export const MAX_REFUSALS = 5;

/**
 * How many times each gate refused the calls about one thing, a scenario or the plan, since the agent last
 * made progress on it.
 *
 * @remarks
 * A call refused for several reasons counts once for each of their codes. Refusals that alternate between
 * reasons still count, each code on its own, so that no refusal repeats without end.
 */
export class RefusalStreak {
  readonly #counts = new Map<string, number>();

  /**
   * Counts a refused call.
   *
   * @param refusals - Its reasons.
   */
  public record(refusals: readonly Refusal[]): void {
    for (const code of new Set(refusals.map((refusal) => refusal.code))) this.#counts.set(code, (this.#counts.get(code) ?? 0) + 1);
  }

  /**
   * The reason of a refusal the agent was refused for most often.
   *
   * @param refusals - The reasons of a refused call, at least one, already counted.
   * @returns Its code and how many times it was refused, the first code of the call when several tie.
   */
  public repeated(refusals: readonly Refusal[]): { readonly code: string; readonly times: number } {
    return refusals.map(({ code }) => ({ code, times: this.#counts.get(code)! })).reduce((most, other) => (other.times > most.times ? other : most));
  }

  /** Forgets every refusal: the agent made progress. */
  public reset(): void {
    this.#counts.clear();
  }
}
