import type { Lesson } from "./lesson.ts";

/** What keeps the lessons the agents are given. */
export interface LessonStorePort {
  /** @returns Every lesson, the latest written first. */
  list(): Promise<Lesson[]>;

  /** Keeps a lesson just written. */
  add(lesson: Lesson): Promise<void>;

  /** Keeps a lesson in place of the one of its identifier. */
  set(lesson: Lesson): Promise<void>;
}
