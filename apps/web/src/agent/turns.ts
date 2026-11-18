import type { ShownStep } from "./playback.ts";
import type { AgentRole } from "@open-qa-stack/domain/sessions";

/** A message the person sent during the session, and the rank of its turn. */
interface Sent {
  readonly rank: number;
  readonly shown: ShownStep;
}

/**
 * A stretch of a thread, as a person reads it: what was asked, what the person said since and whether it reached
 * an agent, what one agent thought, said and did in a row,
 * what the harness asked of an agent, what it noted in a row, or one of its cards.
 */
export type Turn =
  | { readonly kind: "request"; readonly shown: ShownStep }
  | { readonly kind: "message"; readonly shown: ShownStep; readonly deliveredTo?: AgentRole }
  | { readonly kind: "agent"; readonly agent: AgentRole; readonly items: readonly ShownStep[] }
  | { readonly kind: "brief"; readonly shown: ShownStep }
  | { readonly kind: "notes"; readonly items: readonly ShownStep[] }
  | { readonly kind: "card"; readonly shown: ShownStep };

/**
 * Groups the steps a thread shows into turns, so that an agent is named once for everything it does in a row
 * and the notes of the harness do not drown what the agents do.
 *
 * @param shown - The steps, in order.
 * @returns The turns: the request of the person; each message the person sent since, with the agent it reached
 * once a delivery shown says so, the delivery itself being no turn; what an agent said and did until someone else came in; a
 * message of the harness to an agent; the notes of the harness that follow one another; and, each alone, the
 * start of a pass, a verdict, a plan and the outcome.
 */
export function turnsOf(shown: readonly ShownStep[]): Turn[] {
  const turns: Turn[] = [];
  const sent = new Map<number, Sent>();
  for (const item of shown) {
    const { step } = item;
    const last = turns.at(-1);
    if (step.kind === "delivery") {
      const message = sent.get(step.message);
      // The delivery of a message the thread does not show tells nothing.
      if (message !== undefined) turns[message.rank] = { kind: "message", shown: message.shown, deliveredTo: step.to };
    } else if (step.kind === "note") {
      if (last?.kind === "notes") turns[turns.length - 1] = { kind: "notes", items: [...last.items, item] };
      else turns.push({ kind: "notes", items: [item] });
    } else if (step.kind !== "say" && step.kind !== "tool") {
      turns.push({ kind: "card", shown: item });
    } else if (step.kind === "say" && step.number !== undefined) {
      sent.set(step.number, { rank: turns.length, shown: item });
      turns.push({ kind: "message", shown: item });
    } else if (step.from === "user") {
      turns.push({ kind: "request", shown: item });
    } else if (step.from === "harness") {
      turns.push({ kind: "brief", shown: item });
    } else if (last?.kind === "agent" && last.agent === step.from) {
      turns[turns.length - 1] = { kind: "agent", agent: last.agent, items: [...last.items, item] };
    } else {
      turns.push({ kind: "agent", agent: step.from, items: [item] });
    }
  }
  return turns;
}
