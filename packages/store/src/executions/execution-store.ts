import type { Execution, ExecutionResult, ExecutionStorePort } from "@open-qa-stack/domain";
import { instant } from "../database/stored-values.ts";
import type { Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { ExecutionResultsTable, ExecutionsTable, StoreSchema } from "../database/schema.ts";

/** A row of the results as the result it holds, its empty columns left out. */
function resultOf({ path, title, project, verdict, duration_ms, file_digest }: Selectable<ExecutionResultsTable>): ExecutionResult {
  return { path, title, project, verdict, durationMs: duration_ms, ...(file_digest === null ? {} : { fileDigest: file_digest }) };
}

/** A row of the executions as the execution it holds, with its results, its empty columns left out. */
function executionOf(row: Selectable<ExecutionsTable>, results: readonly ExecutionResult[]): Execution {
  const { id, origin, session_id, ran_at, commit_sha, report } = row;
  return {
    id,
    origin,
    ...(session_id === null ? {} : { sessionId: session_id }),
    ranAt: instant(ran_at),
    ...(commit_sha === null ? {} : { commit: commit_sha }),
    report,
    results,
  };
}

/**
 * The executions of tests of the instance, as its database keeps them.
 *
 * @remarks
 * An execution is kept in one transaction, with all of its results or none; each result keeps its rank in the
 * report, which gives back their order.
 */
export class ExecutionStore implements ExecutionStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** Keeps an execution with all of its results, or nothing of it. */
  async add(execution: Execution): Promise<void> {
    const { id, origin, sessionId, ranAt, commit, report, results } = execution;
    await this.#database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("executions")
        .values({ id, origin, session_id: sessionId ?? null, ran_at: instant(ranAt), commit_sha: commit ?? null, report })
        .execute();
      if (results.length === 0) return;
      await transaction
        .insertInto("execution_results")
        .values(
          results.map(({ path, title, project, verdict, durationMs, fileDigest }, position) => ({
            execution_id: id,
            position,
            path,
            title,
            project,
            verdict,
            duration_ms: durationMs,
            file_digest: fileDigest ?? null,
          })),
        )
        .execute();
    });
  }

  /** @returns The executions, the latest first, each with its results in the order of its report. */
  async list(): Promise<Execution[]> {
    const rows = await this.#database.selectFrom("executions").selectAll().orderBy("ran_at", "desc").orderBy("id", "desc").execute();
    const results = await this.#database.selectFrom("execution_results").selectAll().orderBy("execution_id").orderBy("position").execute();
    return rows.map((row) => executionOf(row, results.filter((result) => result.execution_id === row.id).map(resultOf)));
  }
}
