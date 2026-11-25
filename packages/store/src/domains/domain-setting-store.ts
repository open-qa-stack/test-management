import type { DomainSetting, DomainSettingStorePort } from "@open-qa-stack/domain";
import type { Kysely } from "kysely";
import type { Database } from "../database/database.ts";
import type { StoreSchema } from "../database/schema.ts";

/** What a person set of the domains of the knowledge of the instance, as its database keeps it. */
export class DomainSettingStore implements DomainSettingStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** @returns What was set of each domain, in the order of their identifiers. */
  async list(): Promise<DomainSetting[]> {
    const rows = await this.#database.selectFrom("domain_settings").selectAll().orderBy("id").execute();
    return rows.map(({ id, label, excluded }) => ({ id, ...(label === null ? {} : { label }), excluded: excluded === 1 }));
  }

  /** Keeps what was set of a domain, in place of what was before. */
  async set({ id, label, excluded }: DomainSetting): Promise<void> {
    const kept = { label: label ?? null, excluded: Number(excluded) };
    await this.#database
      .insertInto("domain_settings")
      .values({ id, ...kept })
      .onConflict((conflict) => conflict.column("id").doUpdateSet(kept))
      .execute();
  }

  /** Forgets what was set of the domains of these identifiers. */
  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length > 0) await this.#database.deleteFrom("domain_settings").where("id", "in", ids).execute();
  }
}
