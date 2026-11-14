/** A scenario of a plan, as a judge compares it with the others. */
export interface JudgedItem {
  /** Its slug, which names it among the others. */
  readonly id: string;
  /** What it does and what it verifies, as the judge reads it. */
  readonly text: string;
}

/** What a judge found: a scenario that verifies what another already does. */
export interface JudgedDuplicate {
  /** The scenario that adds nothing. */
  readonly id: string;
  /** The scenario, before it, that already verifies it. */
  readonly of: string;
  /** Why, in a sentence. */
  readonly reason: string;
}

/**
 * Tells which scenarios of a plan verify what another already does, though they are not written alike.
 *
 * @remarks
 * It is the second guard against duplicates, after the comparison the harness does itself: a model asked by
 * the harness, outside the session of the agent that plans. The harness checks what it answers, and goes on
 * without it when it fails.
 */
export interface DuplicateJudge {
  /**
   * Judges scenarios against those before them.
   *
   * @param kept - The scenarios already kept, in order.
   * @param candidates - The scenarios to judge, in order: each is compared with those kept and the candidates before it.
   * @returns The candidates that are duplicates.
   * @throws Error when the judge could not answer.
   */
  judge(kept: readonly JudgedItem[], candidates: readonly JudgedItem[]): Promise<readonly JudgedDuplicate[]>;
}
