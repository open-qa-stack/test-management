import type { Lesson, LessonKind, LessonStorePort, LessonTarget } from "@open-qa-stack/domain";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { LessonsTable, StoreSchema } from "../database/schema.ts";

/** The columns a lesson is kept in. */
function rowOf({ id, kind, text, application, target, active, at, test }: Lesson): LessonsTable {
  return { id, kind, text, application: application ?? null, target, active: active ? 1 : 0, written_at: at, test: test ?? null };
}

/** A row of the lessons as the lesson it holds, its empty columns left out. */
function lessonOf(row: Selectable<LessonsTable>): Lesson {
  return {
    id: row.id,
    kind: row.kind as LessonKind,
    text: row.text,
    ...(row.application === null ? {} : { application: row.application }),
    target: row.target as LessonTarget,
    active: row.active === 1,
    at: row.written_at,
    ...(row.test === null ? {} : { test: row.test }),
  };
}

/** The lessons the people of the project give the agents, as the database of the instance keeps them. */
export class LessonStore implements LessonStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** @returns Every lesson, the latest written first, then by identifier. */
  async list(): Promise<Lesson[]> {
    const rows = await this.#database.selectFrom("lessons").selectAll().orderBy("written_at", "desc").orderBy("id").execute();
    return rows.map(lessonOf);
  }

  /** Keeps a lesson just written. */
  async add(lesson: Lesson): Promise<void> {
    await this.#database.insertInto("lessons").values(rowOf(lesson)).execute();
  }

  /** Keeps a lesson in place of the one of its identifier. */
  async set(lesson: Lesson): Promise<void> {
    const { id, ...kept } = rowOf(lesson);
    await this.#database.updateTable("lessons").set(kept).where("id", "=", id).execute();
  }
}
