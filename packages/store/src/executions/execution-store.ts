import {
  UnknownExecutionError,
  type Execution,
  type ExecutionList,
  type ExecutionQuery,
  type ExecutionResult,
  type ExecutionStorePort,
  type TestExecution,
} from "@open-qa-stack/domain";
import { instant } from "../database/stored-values.ts";
import type { ExpressionBuilder, Kysely, Selectable } from "kysely";
import type { Database } from "../database/database.ts";
import type { ExecutionResultsTable, ExecutionsTable, StoreSchema } from "../database/schema.ts";

/** A row of the results as the result it holds, its empty columns left out. */
function resultOf({ path, title, project, verdict, duration_ms, file_digest }: Selectable<ExecutionResultsTable>): ExecutionResult {
  return { path, title, project, verdict, durationMs: duration_ms, ...(file_digest === null ? {} : { fileDigest: file_digest }) };
}

/** A row of the executions as what it says of the execution, but its report and its results, its empty columns left out. */
function headOf({ id, origin, session_id, ran_at, commit_sha }: Selectable<ExecutionsTable>): Omit<Execution, "report" | "results"> {
  return {
    id,
    origin,
    ...(session_id === null ? {} : { sessionId: session_id }),
    ranAt: instant(ran_at),
    ...(commit_sha === null ? {} : { commit: commit_sha }),
  };
}

/** A row of the executions as the execution it holds, with its results. */
function executionOf(row: Selectable<ExecutionsTable>, results: readonly ExecutionResult[]): Execution {
  return { ...headOf(row), report: row.report, results };
}

/** Whether one of the tests of the execution a row holds failed. */
function failed(builder: ExpressionBuilder<StoreSchema, "executions">) {
  return builder.exists(
    builder
      .selectFrom("execution_results")
      .select("execution_results.execution_id")
      .whereRef("execution_results.execution_id", "=", "executions.id")
      .where("execution_results.verdict", "=", "failed"),
  );
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

  /**
   * @returns A page of the executions, the latest first, each with its results in the order of its report.
   * @throws `UnknownExecutionError` when the page starts after an execution it does not keep.
   */
  async page({ limit, before, outcome }: ExecutionQuery): Promise<ExecutionList> {
    let query = this.#database.selectFrom("executions").selectAll("executions");
    if (before !== undefined) {
      const after = await this.#database.selectFrom("executions").select(["ran_at", "id"]).where("id", "=", before).executeTakeFirst();
      if (after === undefined) throw new UnknownExecutionError(before);
      // The executions are ordered by date then identifier: the page goes on after the pair of the one it starts after.
      query = query.where((builder) =>
        builder.or([builder("ran_at", "<", after.ran_at), builder.and([builder("ran_at", "=", after.ran_at), builder("id", "<", after.id)])]),
      );
    }
    if (outcome !== undefined) query = query.where((builder) => (outcome === "failing" ? failed(builder) : builder.not(failed(builder))));
    // One more than the page holds tells whether a page comes after it.
    const rows = await query
      .orderBy("ran_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1)
      .execute();
    const shown = rows.slice(0, limit);
    const results = await this.#resultsOf(shown.map(({ id }) => id));
    const items = shown.map((row) => executionOf(row, results.filter((result) => result.execution_id === row.id).map(resultOf)));
    return rows.length > limit ? { items, next: shown.at(-1)!.id } : { items };
  }

  /** @returns The execution of an identifier with its results in the order of its report; `undefined` when none is kept under it. */
  async get(id: string): Promise<Execution | undefined> {
    const row = await this.#database.selectFrom("executions").selectAll().where("id", "=", id).executeTakeFirst();
    return row === undefined ? undefined : executionOf(row, (await this.#resultsOf([id])).map(resultOf));
  }

  /** @returns What came of the tests of a file in each execution that ran them, the latest first, then in the order of the report. */
  async ofFile(path: string, limit: number): Promise<TestExecution[]> {
    const rows = await this.#database
      .selectFrom("execution_results")
      .innerJoin("executions", "executions.id", "execution_results.execution_id")
      .selectAll("execution_results")
      .select(["executions.id", "executions.origin", "executions.session_id", "executions.ran_at", "executions.commit_sha", "executions.report"])
      .where("execution_results.path", "=", path)
      .orderBy("executions.ran_at", "desc")
      .orderBy("executions.id", "desc")
      .orderBy("execution_results.position")
      .limit(limit)
      .execute();
    return rows.map((row) => ({ ...headOf(row), result: resultOf(row) }));
  }

  /** @returns The report of each execution it keeps. */
  async reports(): Promise<string[]> {
    return (await this.#database.selectFrom("executions").select("report").execute()).map(({ report }) => report);
  }

  /** The results of executions, in the order of their reports. */
  #resultsOf(ids: readonly string[]): Promise<Selectable<ExecutionResultsTable>[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.#database.selectFrom("execution_results").selectAll().where("execution_id", "in", ids).orderBy("execution_id").orderBy("position").execute();
  }
}
