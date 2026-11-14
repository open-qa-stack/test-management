import type { TaskCounters } from "@open-qa-stack/domain";

/**
 * The requests a phase or a source sent to the model, the tokens they sent and received when the model
 * reported them, those of the tokens sent that its server read from its cache, once it reported some, and
 * those of the images they sent, as the harness counts them, once one was.
 */
export interface ModelUsage {
  readonly requests: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  readonly imageTokens?: number;
}

/** What a phase uses when it calls no model. */
export const NO_USAGE: ModelUsage = { requests: 0 };

/**
 * The usage of a task, from its counters.
 *
 * @param counters - What the task used.
 * @returns Its model calls, its tokens when the model reported them, and those of its images once it sent one.
 */
export function usageOf(counters: TaskCounters): ModelUsage {
  const { iterations, inputTokens, outputTokens, cachedTokens, imageTokens } = counters;
  return {
    requests: iterations,
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    ...(imageTokens === undefined ? {} : { imageTokens }),
  };
}

/**
 * Adds usages up.
 *
 * @param usages - The usages of several tasks.
 * @returns Their requests, and their tokens, those read from a cache and those of their images, when at least one of them has some.
 */
export function totalUsage(usages: readonly ModelUsage[]): ModelUsage {
  const reported = usages.filter((usage) => usage.inputTokens !== undefined);
  const imaged = usages.filter((usage) => usage.imageTokens !== undefined);
  const read = usages.filter((usage) => usage.cachedTokens !== undefined);
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const tokens =
    reported.length === 0
      ? {}
      : { inputTokens: sum(reported.map((usage) => usage.inputTokens!)), outputTokens: sum(reported.map((usage) => usage.outputTokens!)) };
  const images = imaged.length === 0 ? {} : { imageTokens: sum(imaged.map((usage) => usage.imageTokens!)) };
  const cached = read.length === 0 ? {} : { cachedTokens: sum(read.map((usage) => usage.cachedTokens!)) };
  return { requests: sum(usages.map((usage) => usage.requests)), ...tokens, ...cached, ...images };
}
