import type { Lesson, LessonStorePort } from "@open-qa-stack/domain";

/** The lessons the agents are given, kept in memory. */
export class MemoryLessonStore implements LessonStorePort {
  readonly #lessons: Lesson[] = [];

  list(): Promise<Lesson[]> {
    return Promise.resolve(this.#lessons.toSorted((a, b) => Number(a.at < b.at) - Number(a.at > b.at)));
  }

  add(lesson: Lesson): Promise<void> {
    this.#lessons.push(lesson);
    return Promise.resolve();
  }

  set(lesson: Lesson): Promise<void> {
    this.#lessons[this.#lessons.findIndex(({ id }) => id === lesson.id)] = lesson;
    return Promise.resolve();
  }
}
