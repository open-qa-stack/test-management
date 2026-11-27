import { isRecord } from "../json.ts";
import type { MemoryKind } from "../memory/memory.ts";
import { LESSON_TARGETS, MAX_LESSON, type LessonTarget } from "./lesson.ts";

/** What a line of the memory is: an instruction or a correction a person gave, or what an agent inferred while it worked. */
export type MemoryItemType = "instruction" | "correction" | "inferred";

/** A line of the memory of the agents, as a person reads it: a lesson a person gave, or what an agent noted. */
export interface MemoryItem {
  readonly id: string;
  readonly type: MemoryItemType;
  /** What the agents keep in mind. */
  readonly text: string;
  /** The application it is kept to; the whole project when left out. */
  readonly application?: string;
  /** The work it is for; what an agent inferred is for every work. */
  readonly target: LessonTarget;
  /** Whether the agents are given it. */
  readonly active: boolean;
  /** When it was written, as an ISO 8601 date. */
  readonly at: string;
  /** For what an agent inferred, the domain and the kind of knowledge it is filed under, and the role of the agent. */
  readonly filed?: { readonly domain: string; readonly kind: MemoryKind; readonly role: string };
}

/** The memory of the agents: its lines, the latest first, and how many are active and set aside. */
export interface MemoryList {
  readonly items: readonly MemoryItem[];
  readonly counts: { readonly active: number; readonly inactive: number };
}

/** What a person changes of a line of the memory: each field given replaces the one it has; `application: null` keeps it to the whole project. */
export interface MemoryChange {
  readonly text?: string;
  readonly application?: string | null;
  readonly target?: LessonTarget;
  readonly active?: boolean;
}

/**
 * Reads a change of a line of the memory as a client sends it.
 *
 * @param value - The body: `{ text?, application?, target?, active? }`, at least one of them.
 * @returns The change, its texts trimmed; or why it is refused, in a sentence.
 */
export function memoryChangeOf(value: unknown): MemoryChange | string {
  if (!isRecord(value) || !["text", "application", "target", "active"].some((field) => value[field] !== undefined))
    return 'A change of the memory is { "text"?, "application"?, "target"?, "active"? }, one of them at least.';
  const { text, application, target, active } = value;
  if (text !== undefined && (typeof text !== "string" || text.trim() === "" || text.trim().length > MAX_LESSON))
    return `The text of a lesson is 1 to ${MAX_LESSON} characters: a rule the agents read as it is.`;
  if (application !== undefined && application !== null && (typeof application !== "string" || application.trim() === ""))
    return "The application of a lesson is the identifier of one, or null for the whole project.";
  if (target !== undefined && !LESSON_TARGETS.some((known) => known === target)) return `The target of a lesson is one of ${LESSON_TARGETS.join(", ")}.`;
  if (active !== undefined && typeof active !== "boolean") return "Whether a lesson is active is true or false.";
  return {
    ...(text === undefined ? {} : { text: (text as string).trim() }),
    ...(application === undefined ? {} : { application: application === null ? null : (application as string).trim() }),
    ...(target === undefined ? {} : { target: target as LessonTarget }),
    ...(active === undefined ? {} : { active: active as boolean }),
  };
}
