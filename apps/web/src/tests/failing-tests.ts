import type { LastVerdict } from "@open-qa-stack/domain/sessions";

/**
 * Counts the tests that failed the last time they ran: a test is named by its file and its title.
 *
 * @param verdicts - What came of each test the last time it ran.
 * @returns How many tests failed.
 */
export function failingTests(verdicts: readonly LastVerdict[]): number {
  return new Set(verdicts.filter(({ verdict }) => verdict === "failed").map(({ path, title }) => `${path}\n${title}`)).size;
}
