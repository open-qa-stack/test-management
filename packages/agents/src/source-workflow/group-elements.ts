import type { AgentEvent, AgentRuntime, IndexSourceType, ModelUsage, StopReason, TaskLimits, ToolDefinition } from "@open-qa-stack/domain";
import { redactText, secretForms, type SourceExport } from "@open-qa-stack/tools";
import { runAgentTask, taskEnd } from "../common/agent-task.ts";
import type { Journal } from "../common/journal.ts";
import { totalUsage, usageOf } from "../common/model-usage.ts";
import { BatchPlacement } from "./batch-placement.ts";
import { elementBatches } from "./element-batches.ts";
import type { Grouping } from "./grouping.ts";
import { batchRequest, groupingInstructions } from "./grouping-prompt.ts";

/** What the grouping of the elements of a source needs. */
export interface GroupElementsOptions {
  /** Identifier of the source. */
  readonly sourceId: string;
  /** What the source is, which the instructions name its elements by. */
  readonly sourceType: IndexSourceType;
  /** The export of the source. */
  readonly exported: SourceExport;
  /** The grouping the placements go to; its settled elements are not asked again. */
  readonly grouping: Grouping;
  /** The domain an earlier run placed an element in, for those that changed since. */
  readonly former: ReadonlyMap<string, string>;
  /** Called once each batch is over, to record where the grouping stands. */
  readonly afterBatch: () => Promise<void>;
  /** The tool the session keeps a fact with for the agents after it. */
  readonly notes: readonly ToolDefinition[];
  /** The runtime that opens the session of each batch. */
  readonly runtime: AgentRuntime;
  /** The limits of each session. */
  readonly limits: TaskLimits;
  /** The secrets of the configuration, masked in every request and which no placement may hold. */
  readonly secrets: readonly string[];
  /** Where what the harness checked and closed is written. */
  readonly journal: Journal;
  /** Receives each message sent to the model, before it is sent. */
  readonly sent: (message: string) => void;
  /** Receives each event of each session, as it comes. */
  readonly received: (event: AgentEvent) => void;
}

/** What the sessions of a step of the workflow of a source used. */
export interface SessionsUse {
  /** What they asked of the model. */
  readonly usage: ModelUsage;
  /** Their iterations, actions and duration, added up. */
  readonly run: { readonly iterations: number; readonly actions: number; readonly durationMs: number };
  /** The first limit that stopped one of them, when one did. */
  readonly stoppedBy?: StopReason["limit"];
}

/** What sessions use when none was opened. */
export const NO_SESSION: SessionsUse = { usage: { requests: 0 }, run: { iterations: 0, actions: 0, durationMs: 0 } };

/**
 * Adds up what two steps of sessions used.
 *
 * @param first - What the first step used.
 * @param second - What the second used.
 * @returns Their total, with the limit that stopped the first of them.
 */
export function addSessions(first: SessionsUse, second: SessionsUse): SessionsUse {
  const stoppedBy = first.stoppedBy ?? second.stoppedBy;
  return {
    usage: totalUsage([first.usage, second.usage]),
    run: {
      iterations: first.run.iterations + second.run.iterations,
      actions: first.run.actions + second.run.actions,
      durationMs: first.run.durationMs + second.run.durationMs,
    },
    ...(stoppedBy === undefined ? {} : { stoppedBy }),
  };
}

/**
 * The use of one session, from its events.
 *
 * @param events - The events of a session run with limits.
 * @returns What it used, and the limit that stopped it when one did.
 */
export function sessionUse(events: readonly AgentEvent[]): SessionsUse {
  const { last, counters } = taskEnd(events);
  return {
    usage: usageOf(counters),
    run: { iterations: counters.iterations, actions: counters.actions, durationMs: Math.round(counters.elapsedMs) },
    ...(last.type === "stopped" ? { stoppedBy: last.reason.limit } : {}),
  };
}

/**
 * Groups the elements of a source into domains, one batch and one session at a time.
 *
 * @remarks
 * The elements no earlier batch settled are cut into batches by `elementBatches`. Each batch gets a session
 * of its own, with `place_elements` and the tool that keeps a note as its only tools, told where the grouping stands, the secrets of the
 * configuration masked. A session a limit
 * stopped leaves the rest of its batch unplaced and the next batch still runs: the limits are those of one
 * session. `afterBatch` is called once each batch is over. A session that fails ends the grouping, and the elements of the batches after it are left
 * unplaced.
 *
 * @param options - What the grouping needs.
 * @returns What the sessions used.
 * @throws Error when a session cannot be opened.
 */
export async function groupElements(options: GroupElementsOptions): Promise<SessionsUse> {
  const { sourceId, exported, grouping, journal } = options;
  const batches = elementBatches(exported.elements.filter((element) => !grouping.isSettled(element.name)));
  const forms = options.secrets.flatMap(secretForms);
  let used = NO_SESSION;
  for (const [i, batch] of batches.entries()) {
    const label = `batch ${i + 1} of ${batches.length}`;
    const placement = new BatchPlacement({ sourceId, label, batch, grouping, secrets: options.secrets, journal });
    const events: AgentEvent[] = [];
    const task = {
      agent: "source-grouping" as const,
      instructions: groupingInstructions(options.sourceType),
      tools: [placement.tool(), ...options.notes],
      request: redactText(batchRequest(sourceId, i + 1, batches.length, batch, grouping, options.former), forms),
      events,
      reminder: () => placement.reminder(),
      sent: options.sent,
      received: options.received,
    };
    await runAgentTask(options.runtime, task, options.limits);
    used = addSessions(used, sessionUse(events));
    const last = events.at(-1)!;
    if (last.type === "stopped") journal.record("error", `The session of ${label} reached its ${last.reason.limit} limit.`, sourceId);
    if (last.type === "error") journal.record("error", `The session of ${label} failed: ${last.error.message}`, sourceId);
    placement.close("The session ended before they were placed.");
    await options.afterBatch();
    if (last.type === "error") break;
  }
  for (const element of exported.elements) {
    if (grouping.state(element.name) === undefined) grouping.leave(element.name, "The grouping stopped before its batch.");
  }
  return used;
}
