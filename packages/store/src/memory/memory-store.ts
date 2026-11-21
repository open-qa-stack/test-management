import type { Memory, MemoryContent, MemoryFilter, MemoryOrigin, MemoryStorePort } from "@open-qa-stack/domain";
import { instant, jsonOf, storedJson } from "../database/stored-values.ts";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { MemoriesTable, StoreSchema } from "../database/schema.ts";

/** A row of the memories as the memory it holds, its empty columns left out. */
function memoryOf(row: Selectable<MemoriesTable>): Memory {
  const { id, domain, kind, text, tags, source, written_role, written_task, written_at, revised_role, revised_task, revised_at } = row;
  return {
    id,
    domain,
    kind,
    text,
    tags: jsonOf(tags),
    ...(source === null ? {} : { source }),
    written: { role: written_role, task: written_task, at: instant(written_at) },
    ...(revised_at === null ? {} : { revised: { role: revised_role!, task: revised_task!, at: instant(revised_at) } }),
  };
}

/** Orders memories as they were written, then by their identifiers, code unit by code unit, the same on every database. */
function byWriting(left: Memory, right: Memory): number {
  const [a, b] = [`${left.written.at} ${left.id}`, `${right.written.at} ${right.id}`];
  return Number(a > b) - Number(a < b);
}

/**
 * The memories of the agents of the instance, as its database keeps them.
 *
 * @remarks
 * Two memories written in the same millisecond are listed in the order of their identifiers.
 */
export class MemoryStore implements MemoryStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** @returns The memories that equal every filter given, in the order they were written. */
  async list({ domain, kind, source }: MemoryFilter): Promise<Memory[]> {
    let query = this.#database.selectFrom("memories").selectAll();
    if (domain !== undefined) query = query.where("domain", "=", domain);
    if (kind !== undefined) query = query.where("kind", "=", kind);
    if (source !== undefined) query = query.where("source", "=", source);
    return (await query.execute()).map(memoryOf).sort(byWriting);
  }

  /** Keeps a memory just written. */
  async add({ id, domain, kind, text, tags, source, written }: Memory): Promise<void> {
    await this.#database
      .insertInto("memories")
      .values({
        id,
        domain,
        kind,
        text,
        tags: storedJson(tags),
        source: source ?? null,
        written_role: written.role,
        written_task: written.task,
        written_at: instant(written.at),
        revised_role: null,
        revised_task: null,
        revised_at: null,
      })
      .execute();
  }

  /** Corrects what a memory says, and tells whether it was kept. */
  async revise(id: string, { text, tags, source }: MemoryContent, revised: MemoryOrigin): Promise<boolean> {
    const changed = await this.#database
      .updateTable("memories")
      .set({
        text,
        tags: storedJson(tags),
        source: source ?? null,
        revised_role: revised.role,
        revised_task: revised.task,
        revised_at: instant(revised.at),
      })
      .where("id", "=", id)
      .executeTakeFirst();
    return changed.numUpdatedRows > 0n;
  }
}
