import {
  UnknownExecutionError,
  versionStep,
  type Execution,
  type ExecutionFailure,
  type ExecutionList,
  type ExecutionQuery,
  type ExecutionResult,
  type ExecutionStorePort,
  type TestExecution,
  type TestVersion,
} from "@open-qa-stack/domain";
import { instant } from "../database/stored-values.ts";
import type { ExpressionBuilder, Kysely, Selectable, SelectQueryBuilder, Transaction } from "kysely";
import type { Database } from "../database/database.ts";
import type { ExecutionResultsTable, ExecutionsTable, StoreSchema, TestVersionsTable } from "../database/schema.ts";

/** Where a test failed and why, as the columns of a row of the results keep it; `undefined` when they keep nothing of it. */
function failureOf({ failed_step, failed_step_title, error_message, expected, received }: Selectable<ExecutionResultsTable>): ExecutionFailure | undefined {
  const failure: ExecutionFailure = {
    ...(failed_step === null || failed_step_title === null ? {} : { step: { number: failed_step, title: failed_step_title } }),
    ...(error_message === null ? {} : { message: error_message }),
    ...(expected === null || received === null ? {} : { expected, received }),
  };
  return Object.keys(failure).length === 0 ? undefined : failure;
}

/** A row of the results as the result it holds, its empty columns left out. */
function resultOf(row: Selectable<ExecutionResultsTable>): ExecutionResult {
  const { path, title, project, verdict, duration_ms, file_digest, test_digest, committed, version } = row;
  const failure = failureOf(row);
  return {
    path,
    title,
    project,
    verdict,
    durationMs: duration_ms,
    ...(file_digest === null ? {} : { fileDigest: file_digest }),
    ...(test_digest === null ? {} : { testDigest: test_digest }),
    ...(committed === null ? {} : { committed: committed === 1 }),
    ...(version === null ? {} : { version }),
    ...(failure === undefined ? {} : { failure }),
  };
}

/** A row of the versions as the version it holds, with how many executions ran it. */
function versionOf({
  path,
  title,
  number,
  digest,
  commit_sha,
  since,
  executions,
}: Selectable<TestVersionsTable> & { readonly executions: number | string }): TestVersion {
  return { path, title, number, digest, ...(commit_sha === null ? {} : { commit: commit_sha }), since: instant(since), executions: Number(executions) };
}

/** A row of the executions as what it says of the execution, but its report and its results, its empty columns left out. */
function headOf({ id, origin, session_id, campaign_id, ran_at, commit_sha }: Selectable<ExecutionsTable>): Omit<Execution, "report" | "results"> {
  return {
    id,
    origin,
    ...(session_id === null ? {} : { sessionId: session_id }),
    ...(campaign_id === null ? {} : { campaignId: campaign_id }),
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
 * An execution is kept in one transaction, with all of its results or none, and the versions of their tests; each
 * result keeps its rank in the report, which gives back their order.
 */
export class ExecutionStore implements ExecutionStorePort {
  readonly #database: Kysely<StoreSchema>;

  /** @param database - The database of the instance, with its migrations applied. */
  constructor(database: Database) {
    this.#database = database.kysely;
  }

  /** Keeps an execution with all of its results and the versions of their tests, or nothing of it. */
  async add(execution: Execution): Promise<void> {
    const { id, origin, sessionId, campaignId, ranAt, commit, report, results } = execution;
    await this.#database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("executions")
        .values({ id, origin, session_id: sessionId ?? null, campaign_id: campaignId ?? null, ran_at: instant(ranAt), commit_sha: commit ?? null, report })
        .execute();
      if (results.length === 0) return;
      const rows = [];
      // One result after the other: a test the execution ran in several projects is versioned once.
      for (const [position, result] of results.entries()) {
        const { path, title, project, verdict, durationMs, fileDigest, testDigest, committed, failure } = result;
        const version = testDigest === undefined ? null : await this.#version(transaction, result, testDigest, committed === true ? commit : undefined, ranAt);
        rows.push({
          execution_id: id,
          position,
          path,
          title,
          project,
          verdict,
          duration_ms: durationMs,
          file_digest: fileDigest ?? null,
          failed_step: failure?.step?.number ?? null,
          failed_step_title: failure?.step?.title ?? null,
          error_message: failure?.message ?? null,
          expected: failure?.expected ?? null,
          received: failure?.received ?? null,
          test_digest: testDigest ?? null,
          committed: committed === undefined ? null : Number(committed),
          version,
        });
      }
      await transaction.insertInto("execution_results").values(rows).execute();
    });
  }

  /**
   * @returns A page of the executions, the latest first, each with its results in the order of its report, with how
   * many the query keeps and the rank of the first of the page among them.
   * @throws `UnknownExecutionError` when the page starts after an execution it does not keep.
   */
  async page({ limit, before, outcome, since }: ExecutionQuery): Promise<ExecutionList> {
    let kept = this.#database.selectFrom("executions");
    if (outcome !== undefined) kept = kept.where((builder) => (outcome === "failing" ? failed(builder) : builder.not(failed(builder))));
    if (since !== undefined) kept = kept.where("ran_at", ">=", instant(since));
    let shown = kept.selectAll("executions");
    let start = 0;
    if (before !== undefined) {
      const after = await this.#database.selectFrom("executions").select(["ran_at", "id"]).where("id", "=", before).executeTakeFirst();
      if (after === undefined) throw new UnknownExecutionError(before);
      // The executions are ordered by date then identifier: the page goes on after the pair of the one it starts after,
      // and those that come before the page are the later pairs, that one with them.
      shown = shown.where((builder) =>
        builder.or([builder("ran_at", "<", after.ran_at), builder.and([builder("ran_at", "=", after.ran_at), builder("id", "<", after.id)])]),
      );
      start = await this.#count(
        kept.where((builder) =>
          builder.or([builder("ran_at", ">", after.ran_at), builder.and([builder("ran_at", "=", after.ran_at), builder("id", ">=", after.id)])]),
        ),
      );
    }
    // One more than the page holds tells whether a page comes after it.
    const rows = await shown
      .orderBy("ran_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1)
      .execute();
    const page = rows.slice(0, limit);
    const results = await this.#resultsOf(page.map(({ id }) => id));
    const items = page.map((row) => executionOf(row, results.filter((result) => result.execution_id === row.id).map(resultOf)));
    const total = await this.#count(kept);
    return { items, total, start, ...(rows.length > limit ? { next: page.at(-1)!.id } : {}) };
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
      .select([
        "executions.id",
        "executions.origin",
        "executions.session_id",
        "executions.campaign_id",
        "executions.ran_at",
        "executions.commit_sha",
        "executions.report",
      ])
      .where("execution_results.path", "=", path)
      .orderBy("executions.ran_at", "desc")
      .orderBy("executions.id", "desc")
      .orderBy("execution_results.position")
      .limit(limit)
      .execute();
    return rows.map((row) => ({ ...headOf(row), result: resultOf(row) }));
  }

  /** @returns The versions of the tests of a file, the latest first, then by their titles, each with how many executions ran it. */
  async versions(path: string): Promise<TestVersion[]> {
    const rows = await this.#database
      .selectFrom("test_versions")
      .selectAll("test_versions")
      .select((builder) =>
        builder
          .selectFrom("execution_results")
          .select((counted) => counted.fn.count<number | string>("execution_results.execution_id").distinct().as("executions"))
          .whereRef("execution_results.path", "=", "test_versions.path")
          .whereRef("execution_results.title", "=", "test_versions.title")
          .whereRef("execution_results.version", "=", "test_versions.number")
          .$asScalar()
          .$notNull()
          .as("executions"),
      )
      .where("path", "=", path)
      .orderBy("since", "desc")
      .orderBy("title")
      .orderBy("number", "desc")
      .execute();
    return rows.map(versionOf);
  }

  /** @returns The executions of a campaign, each with its results in the order of its report, the latest first. */
  async ofCampaign(campaignId: string): Promise<Execution[]> {
    const rows = await this.#database
      .selectFrom("executions")
      .selectAll()
      .where("campaign_id", "=", campaignId)
      .orderBy("ran_at", "desc")
      .orderBy("id", "desc")
      .execute();
    const results = await this.#resultsOf(rows.map(({ id }) => id));
    return rows.map((row) => executionOf(row, results.filter((result) => result.execution_id === row.id).map(resultOf)));
  }

  /** @returns The report of each execution it keeps. */
  async reports(): Promise<string[]> {
    return (await this.#database.selectFrom("executions").select("report").execute()).map(({ report }) => report);
  }

  /** How many executions a query keeps. */
  async #count(query: SelectQueryBuilder<StoreSchema, "executions", object>): Promise<number> {
    const { count } = await query.select((builder) => builder.fn.countAll<number | string>().as("count")).executeTakeFirstOrThrow();
    return Number(count);
  }

  /**
   * The version of the test a result ran it at, in the transaction that keeps its execution: the latest one, which
   * takes the commit when it gets one, or a new one.
   */
  async #version(
    transaction: Transaction<StoreSchema>,
    { path, title }: ExecutionResult,
    digest: string,
    commit: string | undefined,
    ranAt: string,
  ): Promise<number> {
    const latest = await transaction
      .selectFrom("test_versions")
      .select(["number", "digest", "commit_sha"])
      .where("path", "=", path)
      .where("title", "=", title)
      .orderBy("number", "desc")
      .executeTakeFirst();
    const step = versionStep(
      latest === undefined ? undefined : { number: latest.number, digest: latest.digest, ...(latest.commit_sha === null ? {} : { commit: latest.commit_sha }) },
      digest,
      commit,
    );
    if (step.kind === "next")
      await transaction
        .insertInto("test_versions")
        .values({ path, title, number: step.number, digest, commit_sha: step.commit ?? null, since: instant(ranAt) })
        .execute();
    if (step.kind === "committed")
      await transaction
        .updateTable("test_versions")
        .set({ commit_sha: step.commit })
        .where("path", "=", path)
        .where("title", "=", title)
        .where("number", "=", step.number)
        .execute();
    return step.number;
  }

  /** The results of executions, in the order of their reports. */
  #resultsOf(ids: readonly string[]): Promise<Selectable<ExecutionResultsTable>[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.#database.selectFrom("execution_results").selectAll().where("execution_id", "in", ids).orderBy("execution_id").orderBy("position").execute();
  }
}
