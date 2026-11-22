import { sayingOf, type RepeatedNoteStep } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";

/** The rows of notes alike the console words as one sentence, by the code of their notes. */
const ROWS = { cardKept: "harness.rows.cardKept", domainFileKept: "harness.rows.domainFileKept" } as const;

/**
 * Words what the harness said in the language of the console: a note, what a refusal opens on, the reason of a
 * verdict. The harness writes in English; a text of a form the console knows is said again in its words.
 *
 * @param text - What the harness said, whole.
 * @returns It in the words of the console, or as it is when its form is not known.
 */
export function harnessText(text: string): string {
  const saying = sayingOf(text);
  return saying === undefined ? text : t(`harness.${saying.code}`, { ...saying.values, defaultValue: text });
}

/**
 * Words a row of notes alike, the same said of several sources, as one sentence that counts them.
 *
 * @param step - The row.
 * @returns The sentence; for notes of a form the console does not word as a row, what they say around their sources.
 */
export function rowText(step: RepeatedNoteStep): string {
  const code = sayingOf(step.notes[0]!.text)?.code;
  if (code === "cardKept" || code === "domainFileKept") return t(ROWS[code], { count: step.sources.length });
  return `${step.before}…${step.after}`;
}

/**
 * Whether the harness said a text in a form the console words: one it does not is a raw answer, such as an error
 * of a tool, that a person reads under the technical details.
 *
 * @param text - What the harness said.
 * @returns Whether its form is known.
 */
export function isWorded(text: string): boolean {
  return sayingOf(text) !== undefined;
}
