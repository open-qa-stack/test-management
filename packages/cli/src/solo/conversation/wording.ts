import type { ScriptWording } from "@open-qa-stack/domain/sessions";
import { toolTitle } from "./tool-title.ts";

/** How the start of each phase reads; a later version of the contract may name another. */
const PHASES: Readonly<Record<string, string>> = {
  configuration: "Configuration",
  prerequisites: "Prerequisites",
  survey: "Cartography · sources",
  card: "Cartography · card",
  consolidation: "Cartography · domains",
  index: "Cartography · index",
  plan: "Plan",
  review: "Plan review",
  write: "Writing a test",
  execution: "Running the tests",
  summary: "Summary",
};

/** The words of the terminal for what a thread tells; a phase it does not know reads as a step of the work, without more. */
export const WORDING: ScriptWording = {
  phase: (phase) => PHASES[phase] ?? "Step",
  tool: toolTitle,
  planAccepted: "Plan accepted by the harness",
  interrupted: "The session stopped without going to its end.",
  verdicts: (tests) => `Verdicts of the run: ${tests} test${tests === 1 ? "" : "s"}`,
  closed: (scenarios) => `${scenarios} test${scenarios === 1 ? "" : "s"} closed by the harness`,
  opened: (day, time) => `Session of ${day} at ${time} UTC`,
};
