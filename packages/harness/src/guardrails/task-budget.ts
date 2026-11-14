import type { StopReason, TaskCounters, TaskLimits } from "@open-qa-stack/domain";
import type { RequestGate } from "../model-gateway/request-gate.ts";
import type { Clock } from "./clock.ts";

/**
 * Counts what a task uses and stops it at its first limit.
 *
 * @remarks
 * Each count is a checkpoint: the duration is checked first, then the limit of what is counted. A call
 * that reaches a limit exactly is allowed; the one that would exceed it stops the task. Once stopped, the
 * budget stays stopped and counts nothing more.
 */
export class TaskBudget implements RequestGate {
  private readonly limits: TaskLimits;
  private readonly clock: Clock;
  private readonly startedAt: number;
  private iterations = 0;
  private actions = 0;
  private tokens: { input: number; output: number } | undefined;
  private imageTokens: number | undefined;
  private cachedTokens: number | undefined;
  private reason: StopReason | undefined;

  /**
   * @param limits - Limits of the task.
   * @param clock - Where the time comes from; the task starts now.
   */
  public constructor(limits: TaskLimits, clock: Clock) {
    this.limits = limits;
    this.clock = clock;
    this.startedAt = clock.now();
  }

  /** {@inheritDoc RequestGate.stopped} */
  public get stopped(): boolean {
    return this.reason !== undefined;
  }

  /** Why the task stopped, or `undefined` while it runs. */
  public get stopReason(): StopReason | undefined {
    return this.reason;
  }

  /**
   * What the task has used so far.
   *
   * @returns Its iterations, browser actions and elapsed time, its tokens once the model reported some, those
   * its server read from its cache once it reported some, and those of its images once it sent one.
   */
  public get counters(): TaskCounters {
    const tokens = this.tokens === undefined ? {} : { inputTokens: this.tokens.input, outputTokens: this.tokens.output };
    const images = this.imageTokens === undefined ? {} : { imageTokens: this.imageTokens };
    const cached = this.cachedTokens === undefined ? {} : { cachedTokens: this.cachedTokens };
    return { iterations: this.iterations, actions: this.actions, elapsedMs: this.elapsedMs, ...tokens, ...cached, ...images };
  }

  private get elapsedMs(): number {
    return this.clock.now() - this.startedAt;
  }

  /** Counts a model call, unless it would exceed the iteration limit. */
  public startIteration(): void {
    this.expireIfLate();
    if (this.stopped) return;
    if (exceeds(this.iterations + 1, this.limits.maxIterations)) return this.stop("iterations");
    this.iterations++;
  }

  /** {@inheritDoc RequestGate.countTokens} */
  public countTokens(input: number, output: number): void {
    this.tokens = { input: (this.tokens?.input ?? 0) + input, output: (this.tokens?.output ?? 0) + output };
  }

  /** {@inheritDoc RequestGate.countCachedTokens} */
  public countCachedTokens(tokens: number): void {
    if (tokens > 0) this.cachedTokens = (this.cachedTokens ?? 0) + tokens;
  }

  /** {@inheritDoc RequestGate.countImageTokens} */
  public countImageTokens(tokens: number): void {
    if (tokens > 0) this.imageTokens = (this.imageTokens ?? 0) + tokens;
  }

  /**
   * Counts a tool call, unless it is a browser action that would exceed the action limit.
   *
   * @param browserAction - Whether the call counts as a browser action.
   */
  public startToolCall(browserAction: boolean): void {
    this.expireIfLate();
    if (this.stopped || !browserAction) return;
    if (exceeds(this.actions + 1, this.limits.maxActions)) return this.stop("actions");
    this.actions++;
  }

  private expireIfLate(): void {
    if (!this.stopped && exceeds(this.elapsedMs, this.limits.maxDurationMs)) this.stop("duration");
  }

  private stop(limit: StopReason["limit"]): void {
    this.reason = { limit, counters: this.counters };
  }
}

function exceeds(value: number, limit: number | null): boolean {
  return limit !== null && value > limit;
}
