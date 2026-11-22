import type { IdentifiedTest, TestPlace, TestStorePort } from "@open-qa-stack/domain";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "../database/database.ts";
import type { StoreSchema } from "../database/schema.ts";

/** Whether two places are one. */
function same(one: TestPlace, other: TestPlace): boolean {
  return one.path === other.path && one.title === other.title;
}

/**
 * The tests of the instance under their identifier, as its database keeps them, with where each is now.
 *
 * @remarks
 * The versions and the results of a test are kept under its place, the path of its file and its titles, as the runner
 * names it. A test that keeps its identifier and changes its place has been renamed or moved: its history follows it,
 * in the same transaction as its new place, so that it is never kept under two.
 */
export class TestStore implements TestStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** Keeps where each test is under its identifier, and moves the history of a test whose place changed with it. */
  async identify(tests: readonly IdentifiedTest[]): Promise<void> {
    if (tests.length === 0) return;
    const rows = await this.#database
      .selectFrom("tests")
      .selectAll()
      .where(
        "id",
        "in",
        tests.map(({ id }) => id),
      )
      .execute();
    const kept = new Map(rows.map((row) => [row.id, row]));
    const changed = tests.filter((test) => {
      const row = kept.get(test.id);
      return row === undefined || !same(row, test) || (test.was !== undefined && !same(test.was, test));
    });
    if (changed.length === 0) return;
    await this.#database.transaction().execute(async (transaction) => {
      for (const test of changed) {
        const { id, path, title } = test;
        const row = kept.get(id);
        // A listing may have kept the new place before the change that made it told the former one.
        const was = row !== undefined && !same(row, test) ? row : test.was;
        if (was !== undefined && !same(was, test)) await this.#move(transaction, was, test);
        if (row === undefined) await transaction.insertInto("tests").values({ id, path, title }).execute();
        else await transaction.updateTable("tests").set({ path, title }).where("id", "=", id).execute();
      }
    });
  }

  /** Moves the history of a test from its former place to its new one, unless the new one has versions of its own. */
  async #move(transaction: Transaction<StoreSchema>, from: TestPlace, to: TestPlace): Promise<void> {
    const taken = await transaction.selectFrom("test_versions").select("number").where("path", "=", to.path).where("title", "=", to.title).executeTakeFirst();
    if (taken !== undefined) return;
    for (const table of ["test_versions", "execution_results", "campaign_tests"] as const)
      await transaction.updateTable(table).set({ path: to.path, title: to.title }).where("path", "=", from.path).where("title", "=", from.title).execute();
  }
}
