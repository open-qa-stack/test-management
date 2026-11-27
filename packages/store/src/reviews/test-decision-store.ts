import type { SetAsideReason, TestDecision, TestDecisionStorePort } from "@open-qa-stack/domain";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { StoreSchema, TestDecisionsTable } from "../database/schema.ts";

/** What a person decided of the tests the agents wrote, as the database of the instance keeps it. */
export class TestDecisionStore implements TestDecisionStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** @returns Every decision, in the order of the identifiers of the tests. */
  async list(): Promise<TestDecision[]> {
    const rows = await this.#database.selectFrom("test_decisions").selectAll().orderBy("id").execute();
    return rows.map(decisionOf);
  }

  /** Keeps a decision, in place of the one before for the same test. */
  async set(decision: TestDecision): Promise<void> {
    const kept = rowOf(decision);
    await this.#database
      .insertInto("test_decisions")
      .values({ id: decision.id, ...kept })
      .onConflict((conflict) => conflict.column("id").doUpdateSet(kept))
      .execute();
  }

  /** Forgets the decision made of a test, which is then to review again. */
  async drop(id: string): Promise<void> {
    await this.#database.deleteFrom("test_decisions").where("id", "=", id).execute();
  }
}

/** The columns a decision is kept in, but its identifier. */
function rowOf(decision: TestDecision): Omit<TestDecisionsTable, "id"> {
  const none = { decided_at: decision.at, reason: null, covered_by: null, note: null, session: null };
  if (decision.status === "validated") return { ...none, status: decision.status };
  if (decision.status === "in_correction") return { ...none, status: decision.status, note: decision.instruction, session: decision.session };
  return { ...none, status: decision.status, reason: decision.reason, covered_by: decision.coveredBy ?? null, note: decision.note ?? null };
}

function decisionOf(row: Selectable<TestDecisionsTable>): TestDecision {
  if (row.status === "validated") return { id: row.id, status: "validated", at: row.decided_at };
  if (row.status === "in_correction") return { id: row.id, status: "in_correction", at: row.decided_at, instruction: row.note!, session: row.session! };
  return {
    id: row.id,
    status: "set_aside",
    at: row.decided_at,
    reason: row.reason as SetAsideReason,
    ...(row.covered_by === null ? {} : { coveredBy: row.covered_by }),
    ...(row.note === null ? {} : { note: row.note }),
  };
}
