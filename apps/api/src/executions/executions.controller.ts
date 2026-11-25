import { BadRequestException, Controller, Get, Header, Param, Query } from "@nestjs/common";
import { Executions } from "@open-qa-stack/engine";
import { EXECUTION_ORIGINS, type ExecutionOrigin } from "@open-qa-stack/domain";
import type { Execution, ExecutionList, ExecutionOutcome } from "@open-qa-stack/domain/sessions";

/** How many executions a page holds when the query does not say. */
export const DEFAULT_PAGE_SIZE = 25;
/** How many executions a page holds at most. */
export const MAX_PAGE_SIZE = 100;

/** An ISO 8601 date, to the day at least, with its time zone when it gives its time. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** What the outcomes of a query may be. */
const OUTCOMES: readonly ExecutionOutcome[] = ["failing", "passing"];

/** `GET /executions` and `GET /executions/:id`: the operations on the executions of tests the instance keeps, said in HTTP. */
@Controller("executions")
export class ExecutionsController {
  readonly #executions: Executions;

  constructor(executions: Executions) {
    this.#executions = executions;
  }

  /**
   * @returns A page of the executions, the latest first, each with what came of each of its tests, which no cache may
   * keep; `next` names the last one, to ask for the page after it with `before`; `total` tells how many the query
   * keeps, `start` the rank of the first of the page among them.
   */
  @Get()
  @Header("Cache-Control", "no-store")
  page(
    @Query("limit") limit: unknown,
    @Query("before") before: unknown,
    @Query("outcome") outcome: unknown,
    @Query("origin") origin: unknown,
    @Query("since") since: unknown,
  ): Promise<ExecutionList> {
    const size = limit === undefined ? DEFAULT_PAGE_SIZE : typeof limit === "string" && /^[1-9]\d{0,2}$/.test(limit) ? Number(limit) : 0;
    if (size < 1 || size > MAX_PAGE_SIZE) throw new BadRequestException(`limit is how many executions a page holds, from 1 to ${MAX_PAGE_SIZE}.`);
    if (before !== undefined && (typeof before !== "string" || before === ""))
      throw new BadRequestException("before is the identifier of an execution: the next of a page.");
    if (outcome !== undefined && !OUTCOMES.includes(outcome as ExecutionOutcome)) throw new BadRequestException(`outcome is one of ${OUTCOMES.join(", ")}.`);
    if (origin !== undefined && !EXECUTION_ORIGINS.includes(origin as ExecutionOrigin))
      throw new BadRequestException(`origin is one of ${EXECUTION_ORIGINS.join(", ")}.`);
    if (since !== undefined && (typeof since !== "string" || !ISO_DATE.test(since) || Number.isNaN(Date.parse(since))))
      throw new BadRequestException("since is an ISO 8601 date, such as 2026-11-20 or 2026-11-20T08:00:00Z.");
    return this.#executions.page({
      limit: size,
      ...(before === undefined ? {} : { before }),
      ...(outcome === undefined ? {} : { outcome: outcome as ExecutionOutcome }),
      ...(origin === undefined ? {} : { origin: origin as ExecutionOrigin }),
      ...(since === undefined ? {} : { since: new Date(since).toISOString() }),
    });
  }

  /** @returns The execution of the identifier, with what came of each of its tests, which no cache may keep. */
  @Get(":id")
  @Header("Cache-Control", "no-store")
  get(@Param("id") id: string): Promise<Execution> {
    return this.#executions.get(id);
  }
}
