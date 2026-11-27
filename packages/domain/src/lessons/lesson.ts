import { isRecord } from "../json.ts";

/** Where a lesson comes from: an instruction a person wrote, or the correction they asked of a test. */
export const LESSON_KINDS = ["instruction", "correction"] as const;

/** Where a lesson comes from. */
export type LessonKind = (typeof LESSON_KINDS)[number];

/** The work a lesson is for: the design of the tests, the discovery of the applications, or both. */
export const LESSON_TARGETS = ["design", "discovery", "all"] as const;

/** The work a lesson is for. */
export type LessonTarget = (typeof LESSON_TARGETS)[number];

/** The longest lesson, in characters: a rule, not a context. */
export const MAX_LESSON = 600;

/** What a person sets of a lesson: what the agents must keep in mind, where, for what, and whether it applies. */
export interface LessonDraft {
  /** What the agents must keep in mind, in the words of the person: a rule they read as it is before each task. */
  readonly text: string;
  /** The application it is kept to; the whole project when left out. */
  readonly application?: string;
  readonly target: LessonTarget;
  /** Whether the agents are given it; a lesson set aside is kept, and given no more. */
  readonly active: boolean;
}

/** A lesson the agents are given before each task it is for, as the instance keeps it. */
export interface Lesson extends LessonDraft {
  /** Its identifier, given when it is written and never changed. */
  readonly id: string;
  readonly kind: LessonKind;
  /** When it was written, as an ISO 8601 date. */
  readonly at: string;
  /** For a correction, the identifier of the test it was asked of. */
  readonly test?: string;
}

/** A text that is no empty string once trimmed, as the given one trimmed. */
function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * Reads a lesson as a client sends it.
 *
 * @param value - The body: `{ text, application?, target, active? }`; a lesson is active when `active` is left out.
 * @returns The lesson, its texts trimmed; or why it is refused, in a sentence.
 */
export function lessonDraftOf(value: unknown): LessonDraft | string {
  if (!isRecord(value)) return 'A lesson is { "text", "application"?, "target", "active"? }.';
  const text = textOf(value["text"]);
  if (text === undefined || text.length > MAX_LESSON) return `The text of a lesson is 1 to ${MAX_LESSON} characters: a rule the agents read as it is.`;
  const target = LESSON_TARGETS.find((known) => known === value["target"]);
  if (target === undefined) return `The target of a lesson is one of ${LESSON_TARGETS.join(", ")}.`;
  if (value["active"] !== undefined && typeof value["active"] !== "boolean") return "Whether a lesson is active is true or false.";
  const application = textOf(value["application"]);
  return { text, ...(application === undefined ? {} : { application }), target, active: value["active"] !== false };
}

/**
 * The lessons an agent is given before a task: those active, for its work or for all, of the whole project or of the
 * application of the task. A task of no single application, such as one that plans across them, is given those of
 * every application.
 *
 * @param lessons - The lessons of the instance.
 * @param work - The work of the task.
 * @param application - The application of the task, when it has a single one.
 * @returns The lessons, in the order given.
 */
export function lessonsFor(lessons: readonly Lesson[], work: Exclude<LessonTarget, "all">, application?: string): Lesson[] {
  return lessons.filter(
    (lesson) =>
      lesson.active &&
      (lesson.target === work || lesson.target === "all") &&
      (lesson.application === undefined || application === undefined || lesson.application === application),
  );
}

/**
 * What the instructions of an agent say of the lessons it is given: each on a line, with the application it is kept to.
 *
 * @param lessons - The lessons given, as `lessonsFor` selects them.
 * @returns The text to add to the instructions; empty without a lesson.
 */
export function lessonsRule(lessons: readonly Lesson[]): string {
  if (lessons.length === 0) return "";
  const lines = lessons.map(({ text, application }) => `- ${application === undefined ? "" : `For the application ${application}: `}${text}`);
  return `The people of the project gave these instructions, which you follow as they are, whatever else you are told:\n${lines.join("\n")}`;
}
