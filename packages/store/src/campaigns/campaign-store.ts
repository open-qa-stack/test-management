import type { Campaign, CampaignStatus, CampaignStorePort, CampaignTest } from "@open-qa-stack/domain";
import { instant } from "../database/stored-values.ts";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { CampaignsTable, StoreSchema } from "../database/schema.ts";

/** A row of the campaigns as the campaign it holds, with its tests, its empty dates left out. */
function campaignOf(row: Selectable<CampaignsTable>, tests: readonly CampaignTest[]): Campaign {
  const { id, name, environment, status, created_at, ready_at, closed_at } = row;
  return {
    id,
    name,
    environment,
    status,
    createdAt: instant(created_at),
    ...(ready_at === null ? {} : { readyAt: instant(ready_at) }),
    ...(closed_at === null ? {} : { closedAt: instant(closed_at) }),
    tests,
  };
}

/**
 * The campaigns of the instance, as its database keeps them: each with the tests chosen for it, in the order of their
 * paths then their titles.
 */
export class CampaignStore implements CampaignStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** Keeps a campaign that was just planned. */
  async add({ id, name, environment, status, createdAt }: Campaign): Promise<void> {
    await this.#database
      .insertInto("campaigns")
      .values({ id, name, environment, status, created_at: instant(createdAt), ready_at: null, closed_at: null })
      .execute();
  }

  /** @returns The campaign of an identifier with its tests; `undefined` when none is kept under it. */
  async get(id: string): Promise<Campaign | undefined> {
    const row = await this.#database.selectFrom("campaigns").selectAll().where("id", "=", id).executeTakeFirst();
    return row === undefined ? undefined : campaignOf(row, await this.#testsOf(id));
  }

  /** @returns Every campaign, the latest planned first, each with its tests. */
  async list(): Promise<Campaign[]> {
    const rows = await this.#database.selectFrom("campaigns").selectAll().orderBy("created_at", "desc").orderBy("id", "desc").execute();
    return Promise.all(rows.map(async (row) => campaignOf(row, await this.#testsOf(row.id))));
  }

  /** Replaces the tests chosen for a campaign, all of them or none. */
  async choose(id: string, tests: readonly CampaignTest[]): Promise<void> {
    await this.#database.transaction().execute(async (transaction) => {
      await transaction.deleteFrom("campaign_tests").where("campaign_id", "=", id).execute();
      if (tests.length > 0)
        await transaction
          .insertInto("campaign_tests")
          .values(tests.map(({ path, title }) => ({ campaign_id: id, path, title })))
          .execute();
    });
  }

  /** Fixes the tests of a campaign, which becomes ready. */
  async ready(id: string, at: string): Promise<void> {
    await this.#database
      .updateTable("campaigns")
      .set({ status: "ready", ready_at: instant(at) })
      .where("id", "=", id)
      .execute();
  }

  /** Changes the state of a campaign: to `in_progress`, or to `closed` with when. */
  async move(id: string, status: Extract<CampaignStatus, "in_progress" | "closed">, at?: string): Promise<void> {
    await this.#database
      .updateTable("campaigns")
      .set({ status, ...(at === undefined ? {} : { closed_at: instant(at) }) })
      .where("id", "=", id)
      .execute();
  }

  /** The tests of a campaign, in the order of their paths then their titles. */
  async #testsOf(id: string): Promise<CampaignTest[]> {
    const rows = await this.#database
      .selectFrom("campaign_tests")
      .select(["path", "title"])
      .where("campaign_id", "=", id)
      .orderBy("path")
      .orderBy("title")
      .execute();
    return rows.map(({ path, title }) => ({ path, title }));
  }
}
