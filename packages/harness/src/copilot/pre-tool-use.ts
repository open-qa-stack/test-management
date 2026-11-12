import type { SessionHooks } from "@github/copilot-sdk";
import type { StopReason } from "@open-qa-stack/domain";
import type { TaskBudget } from "../guardrails/task-budget.ts";

type PreToolUseHook = NonNullable<SessionHooks["onPreToolUse"]>;
type PreToolUseInput = Parameters<PreToolUseHook>[0];
type PreToolUseDecision = { permissionDecision: "allow" | "deny"; permissionDecisionReason?: string };

/** A call the pre-tool hook refused, and the limit that refused it. */
export interface RefusedCall {
  /** Name of the tool the model called. */
  readonly tool: string;
  /** The limit the task had reached. */
  readonly limit: StopReason["limit"];
}

/** What the pre-tool hook of a session needs. */
export interface PreToolUseContext {
  /** Budget of the task, if it has limits. */
  readonly budget: TaskBudget | undefined;
  /** Names of the tools whose calls count as browser actions. */
  readonly browserTools: ReadonlySet<string>;
  /** Calls the hook refused, by call identifier; the session reports them when they complete. */
  readonly refused: Map<string, RefusedCall>;
}

/**
 * Counts a tool call against the task's budget, and refuses it once the task is stopped.
 *
 * @remarks
 * This is the SDK's pre-tool hook: it must answer with a decision, so it both records the call and
 * decides. A refused call never runs. Older Copilot runtimes give no call identifier: the call is then
 * refused all the same, but the session cannot report which call it was.
 *
 * @param input - The call, as the SDK describes it.
 * @param context - The budget and what the session tracks.
 * @returns `deny` with the limit reached, or `allow`.
 */
export function preToolUse(input: PreToolUseInput, context: PreToolUseContext): PreToolUseDecision {
  const { budget } = context;
  if (budget === undefined) return { permissionDecision: "allow" };
  budget.startToolCall(context.browserTools.has(input.toolName));
  const stop = budget.stopReason;
  if (stop === undefined) return { permissionDecision: "allow" };
  if (input.toolCallId !== undefined) context.refused.set(input.toolCallId, { tool: input.toolName, limit: stop.limit });
  return { permissionDecision: "deny", permissionDecisionReason: `The task reached its ${stop.limit} limit.` };
}
