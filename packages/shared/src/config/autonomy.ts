import type { Autonomy, ResolvedLimits } from "./types.ts";

const SUPERVISED: ResolvedLimits = {
  task: { maxIterations: 5, maxDurationMinutes: 10, maxActions: 200 },
  batch: { maxTests: 40, maxIdleRounds: 3, stopOnPlateau: false },
  guardrailMinutes: null,
};

/**
 * Per-task limits, the scope of the guardrail and how a plateau is detected are not specified for the
 * autonomous level; the documentation lists the assumptions made here.
 */
const AUTONOMOUS: ResolvedLimits = {
  task: { maxIterations: null, maxDurationMinutes: null, maxActions: null },
  batch: { maxTests: null, maxIdleRounds: null, stopOnPlateau: true },
  guardrailMinutes: 120,
};

/** Limits a level imposes; `null` means the level sets no bound. */
export function resolveLimits(autonomy: Autonomy): ResolvedLimits {
  switch (autonomy.level) {
    case "supervised":
      return structuredClone(SUPERVISED);
    case "autonomous":
      return structuredClone(AUTONOMOUS);
    case "custom":
      return {
        task: { ...autonomy.task },
        batch: { ...autonomy.batch, stopOnPlateau: false },
        guardrailMinutes: autonomy.guardrailMinutes,
      };
  }
}
