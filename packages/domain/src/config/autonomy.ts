import type { Autonomy, ResolvedLimits } from "./types.ts";

/** How long the tasks of a run may go on when the file says nothing, in minutes, whatever the level. */
export const DEFAULT_GUARDRAIL_MINUTES = 120;

/** How long a task of the bounded level may last when the level is the default, in minutes. */
export const DEFAULT_TASK_MINUTES = 10;

/** The tests a batch of the bounded level may write when the file gives no other count. */
export const DEFAULT_BATCH_TESTS = 40;

/** The rounds in a row that may bring no new test before a batch ends, when the file gives no other count, and at the autonomous level. */
export const DEFAULT_IDLE_ROUNDS = 3;

/** The level an absent `autonomy` stands for: bounded, each task to ten minutes. */
export const DEFAULT_AUTONOMY: Autonomy = { level: "bounded", task: { maxMinutes: DEFAULT_TASK_MINUTES } };

/** The levels of earlier format versions, with what to write instead. */
export const RETIRED_LEVELS: Readonly<Record<string, string>> = {
  supervised:
    'The level "supervised" is no longer supported: write "bounded", with its limits in /autonomy/task, such as { "maxIterations": 5, "maxMinutes": 10, "maxActions": 200 }.',
  custom:
    'The level "custom" is no longer supported: write "bounded", with its limits in /autonomy/task, where maxDurationMinutes is now maxMinutes, and those of its batch in /autonomy/batch, such as { "maxTests": 40, "maxIdleRounds": 3 }.',
};

/**
 * Gives the limits of an autonomy level.
 *
 * @param autonomy - The level, with its limits when it is `bounded`.
 * @returns The limits; `null` means the level sets no such bound. The guardrail holds at each level, two hours by default,
 *   and so does the end of a batch after rounds that bring no new test, which only the bounded level lets the file set.
 */
export function resolveLimits(autonomy: Autonomy): ResolvedLimits {
  if (autonomy.level === "autonomous") {
    return {
      task: { maxIterations: null, maxMinutes: null, maxActions: null },
      batch: { maxTests: null, maxIdleRounds: DEFAULT_IDLE_ROUNDS },
      guardrailMinutes: autonomy.guardrailMinutes ?? DEFAULT_GUARDRAIL_MINUTES,
    };
  }
  const { task, batch } = autonomy;
  return {
    task: { maxIterations: task.maxIterations ?? null, maxMinutes: task.maxMinutes ?? null, maxActions: task.maxActions ?? null },
    batch: { maxTests: batch?.maxTests ?? DEFAULT_BATCH_TESTS, maxIdleRounds: batch?.maxIdleRounds ?? DEFAULT_IDLE_ROUNDS },
    guardrailMinutes: autonomy.guardrailMinutes ?? DEFAULT_GUARDRAIL_MINUTES,
  };
}
