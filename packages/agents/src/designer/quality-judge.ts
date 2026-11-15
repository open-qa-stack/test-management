import type { QualityFinding } from "./design-state.ts";

/**
 * Tells what the code of a test lacks in quality, whatever its plan.
 *
 * @remarks
 * The harness checks by itself what a tool measures: the compiler, the lint rules of the charter. What is
 * left — a rule of the charter no tool checks, code that hides a failure, does nothing or reads badly — is
 * asked of a model outside the session of the agent that wrote the test. The harness tells its findings to
 * that agent once, keeps them with the test, and goes on without it when it fails: it never refuses a test
 * alone.
 */
export interface QualityJudge {
  /**
   * Reviews the code of a test.
   *
   * @param test - The text of the test, which passed.
   * @returns What it found; none when the code needs nothing.
   * @throws Error when the judge could not answer.
   */
  judge(test: string): Promise<readonly QualityFinding[]>;
}
