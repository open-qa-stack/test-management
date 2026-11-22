import type { AgentRole } from "../session-event.ts";
import type { Step, VerdictStep } from "./step.ts";

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
 * what the harness asked of an agent, what it noted in a row, the refusals alike it gave in a row, or one of its cards.
 */
export type Turn<Item extends Shown> =
  | { readonly kind: "request"; readonly shown: Item }
  | { readonly kind: "message"; readonly shown: Item; readonly deliveredTo?: AgentRole }
  | { readonly kind: "agent"; readonly agent: AgentRole; readonly items: readonly Item[] }
  | { readonly kind: "brief"; readonly shown: Item }
  | { readonly kind: "notes"; readonly items: readonly Item[] }
  | { readonly kind: "refusals"; readonly items: readonly Item[] }
  | { readonly kind: "card"; readonly shown: Item };

/** What makes two refusals alike: the phase, the gate, the tool and what was refused; the scenario and the reason may differ. */
function refusalKey(step: Step): string | undefined {
  if (step.kind !== "verdict" || step.accepted) return undefined;
  const { about, code, tool, subject }: VerdictStep = step;
  return JSON.stringify([about, code, tool, subject]);
}

/** The refusals a turn holds, a card of one or a row of them, when they are alike a refusal of this key. */
function alikeIn<Item extends Shown>(turn: Turn<Item> | undefined, key: string): readonly Item[] | undefined {
  const items = turn?.kind === "refusals" ? turn.items : turn?.kind === "card" ? [turn.shown] : [];
  return items.length > 0 && refusalKey(items[0]!.step) === key ? items : undefined;
}

/**
 * Groups the steps a thread shows into turns, so that an agent is named once for everything it does in a row
 * and the notes of the harness do not drown what the agents do.
 *
 * @param shown - The steps, in order.
 * @returns The turns: the request of the person; each message the person sent since, with the agent it reached
 * once a delivery shown says so, the delivery itself being no turn; what an agent said and did until someone else came in; a
 * message of the harness to an agent; the notes of the harness that follow one another, a row of notes alike among
 * them; the refusals alike that follow one another, by the same gate of the same phase, about the same tool or the same
 * thing; and, each alone, the start of a pass, a verdict, a plan and the outcome.
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
    } else if (step.kind === "note" || step.kind === "repeated") {
      if (last?.kind === "notes") turns[turns.length - 1] = { kind: "notes", items: [...last.items, item] };
      else turns.push({ kind: "notes", items: [item] });
    } else if (step.kind !== "say" && step.kind !== "tool") {
      const key = refusalKey(step);
      const alike = key === undefined ? undefined : alikeIn(last, key);
      if (alike === undefined) turns.push({ kind: "card", shown: item });
      else turns[turns.length - 1] = { kind: "refusals", items: [...alike, item] };
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
