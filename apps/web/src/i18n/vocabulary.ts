import type { TestLevel } from "@open-qa-stack/domain/sessions";
import { RESOURCES, t, type Words } from "./i18n.ts";

/** The levels of the pyramid of tests, from its base to its top. */
export const LEVELS: readonly TestLevel[] = ["smoke", "functional", "business", "cross-application", "end-to-end"];

/** A status of a test, of a session or of a run, as every screen names it. */
export type Status = keyof Words["vocabulary"]["statuses"];

/** A status that the console counts, as `3 failed`. */
export type CountedStatus = Exclude<Status, "stopped">;

/** Where an execution comes from. */
export type Origin = keyof Words["vocabulary"]["origins"];

/** A phase of the work of a session that the console names. */
type Phase = keyof Words["vocabulary"]["phases"];

/** Whether a word names a level of the pyramid. */
const isLevel = (level: string): level is TestLevel => (LEVELS as readonly string[]).includes(level);

/**
 * Names a level of the pyramid of tests, the same on every screen.
 *
 * @param level - The level, as a tag, a plan or the configuration gives it.
 * @returns Its name; the word as it is for a level the console does not know.
 */
export function levelName(level: string): string {
  return isLevel(level) ? t(`vocabulary.levels.${level}.label`) : level;
}

/**
 * Says what a level of the pyramid covers.
 *
 * @param level - The level.
 * @returns What its tests check, in a few words.
 */
export function levelHint(level: TestLevel): string {
  return t(`vocabulary.levels.${level}.hint`);
}

/**
 * Names a status, the same on every screen.
 *
 * @param status - The status.
 * @returns Its name, as a label.
 */
export function statusName(status: Status): string {
  return t(`vocabulary.statuses.${status}`);
}

/**
 * Counts the tests of a status.
 *
 * @param status - The status.
 * @param count - How many tests have it.
 * @returns The count, as `3 failed`.
 */
export function statusCount(status: CountedStatus, count: number): string {
  return t(`vocabulary.counts.${status}`, { count });
}

/**
 * Names where an execution comes from.
 *
 * @param origin - Its origin.
 * @returns The name.
 */
export function originName(origin: Origin): string {
  return t(`vocabulary.origins.${origin}`);
}

/**
 * Names a phase of the work of a session.
 *
 * @param phase - The phase; a later version of the API may name one the console does not know.
 * @returns Its name; a step of the work, without more, for a phase the console does not know.
 */
export function phaseName(phase: string): string {
  return Object.hasOwn(RESOURCES.en.vocabulary.phases, phase) ? t(`vocabulary.phases.${phase as Phase}`) : t("steps.step");
}
