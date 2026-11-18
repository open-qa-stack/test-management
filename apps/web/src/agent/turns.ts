import type { ShownStep } from "./playback.ts";
import type { AgentRole } from "@open-qa-stack/shared/sessions";

/**
 * A stretch of a thread, as a person reads it: what was asked, what one agent thought, said and did in a row,
 * what the harness asked of an agent, what it noted in a row, or one of its cards.
 */
export type Turn =
  | { readonly kind: "request"; readonly shown: ShownStep }
  | { readonly kind: "agent"; readonly agent: AgentRole; readonly items: readonly ShownStep[] }
  | { readonly kind: "brief"; readonly shown: ShownStep }
  | { readonly kind: "notes"; readonly items: readonly ShownStep[] }
  | { readonly kind: "card"; readonly shown: ShownStep };

/**
 * Groups the steps a thread shows into turns, so that an agent is named once for everything it does in a row
 * and the notes of the harness do not drown what the agents do.
 *
 * @param shown - The steps, in order.
 * @returns The turns: the request of the person; what an agent said and did until someone else came in; a
 * message of the harness to an agent; the notes of the harness that follow one another; and, each alone, the
 * start of a pass, a verdict, a plan and the outcome.
 */
export function turnsOf(shown: readonly ShownStep[]): Turn[] {
  const turns: Turn[] = [];
  for (const item of shown) {
    const { step } = item;
    const last = turns.at(-1);
    if (step.kind === "note") {
      if (last?.kind === "notes") turns[turns.length - 1] = { kind: "notes", items: [...last.items, item] };
      else turns.push({ kind: "notes", items: [item] });
    } else if (step.kind !== "say" && step.kind !== "tool") {
      turns.push({ kind: "card", shown: item });
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
