import type { SessionScript, Speaker } from "@open-qa-stack/domain/sessions";

/** Where the work of a session is, as its thread tells it. */
export interface ThreadProgress {
  /** The pass it is in. */
  readonly pass?: string;
  /** The scenario that pass works on, when it works on one. */
  readonly scenario?: string;
  /** The agent that last spoke or acted. */
  readonly agent?: Speaker;
}

/**
 * Reads where the work of a session is from its script.
 *
 * @param script - The script of the session.
 * @returns The last pass that started, with its scenario when it has one, and the agent that spoke or acted
 * last when the thread ends on what an agent said or did; nothing of either before the first.
 */
export function progressOf(script: SessionScript): ThreadProgress {
  const pass = script.steps.findLast((step) => step.kind === "pass");
  const last = script.steps.at(-1);
  const acts = last !== undefined && (last.kind === "say" || last.kind === "tool" || last.kind === "review") && last.from !== "user" && last.from !== "harness";
  return {
    ...(pass === undefined ? {} : { pass: pass.title }),
    ...(pass === undefined || pass.summary === "" ? {} : { scenario: pass.summary }),
    ...(acts ? { agent: last.from } : {}),
  };
}
