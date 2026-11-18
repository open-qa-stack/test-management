import type { AgentRole } from "../session-event.ts";
import type { Step } from "./step.ts";

/** A step as a thread shows it: a presentation adds what it shows of it — its rank, how much of it is written. */
interface Shown {
  readonly step: Step;
}

/** A message the person sent during the session, and the rank of its turn. */
interface Sent<Item> {
  readonly rank: number;
  readonly shown: Item;
}

/**
 * A stretch of a thread, as a person reads it: what was asked, what the person said since and whether it reached
 * an agent, what one agent thought, said and did in a row,
 * what the harness asked of an agent, what it noted in a row, or one of its cards.
 */
export type Turn<Item extends Shown> =
  | { readonly kind: "request"; readonly shown: Item }
  | { readonly kind: "message"; readonly shown: Item; readonly deliveredTo?: AgentRole }
  | { readonly kind: "agent"; readonly agent: AgentRole; readonly items: readonly Item[] }
  | { readonly kind: "brief"; readonly shown: Item }
  | { readonly kind: "notes"; readonly items: readonly Item[] }
  | { readonly kind: "card"; readonly shown: Item };

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
export function turnsOf<Item extends Shown>(shown: readonly Item[]): Turn<Item>[] {
  const turns: Turn<Item>[] = [];
  const sent = new Map<number, Sent<Item>>();
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
