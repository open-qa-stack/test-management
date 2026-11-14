import type { Autonomy, ResolvedLimits } from "./types.ts";

/** How long a run of the autonomous level may last when the file says nothing, in minutes. */
export const DEFAULT_GUARDRAIL_MINUTES = 120;

/** The level an absent `autonomy` stands for. */
export const DEFAULT_AUTONOMY: Autonomy = { level: "autonomous" };

/** The levels of earlier format versions, with what to write instead. */
export const RETIRED_LEVELS: Readonly<Record<string, string>> = {
  supervised:
    'The level "supervised" is no longer supported: write "bounded", with its limits in /autonomy/task, such as { "maxIterations": 5, "maxMinutes": 10, "maxActions": 200 }.',
  custom:
    'The level "custom" is no longer supported: write "bounded", with its limits in /autonomy/task, where maxDurationMinutes is now maxMinutes; batch is no longer supported.',
};

/**
 * Gives the limits of an autonomy level.
 *
 * @param autonomy - The level, with its limits when it is `bounded`.
 * @returns The limits; `null` means the level sets no bound.
 */
export function resolveLimits(autonomy: Autonomy): ResolvedLimits {
  if (autonomy.level === "autonomous") {
    return {
      task: { maxIterations: null, maxMinutes: null, maxActions: null },
      guardrailMinutes: autonomy.guardrailMinutes ?? DEFAULT_GUARDRAIL_MINUTES,
    };
  }
  const { task } = autonomy;
  return {
    task: { maxIterations: task.maxIterations ?? null, maxMinutes: task.maxMinutes ?? null, maxActions: task.maxActions ?? null },
    guardrailMinutes: autonomy.guardrailMinutes ?? null,
  };
}
