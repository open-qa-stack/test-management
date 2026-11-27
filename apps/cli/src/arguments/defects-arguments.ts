import { defectReportOf } from "@open-qa-stack/domain";
import type { Command } from "./command.ts";

/** What `oqas defects` takes after it, for what it is asked. */
const USAGE =
  "oqas defects takes nothing; report then the path of a test, its title, a severity from S1 to S4, a title and a description; or fix, close or open then the reference of a defect.";

/** The actions that move a defect, by the status each moves it to. */
const MOVES = { fix: "fixed", close: "closed", open: "open" } as const;

/**
 * What `oqas defects` asks for, or why it is refused: the defects; one reported from a test; one moved, by its
 * reference; and nothing of a session.
 */
export function defectsOf(words: readonly string[], ofASession: boolean): Command | string {
  if (ofASession) return "oqas defects acts on the defects of the instance: it takes no --brief, --environment nor --follow.";
  if (words.length === 0) return { name: "defects", action: "list" };
  const [action, ...rest] = words;
  if (action === "report" && (rest.length === 4 || rest.length === 5)) {
    const [path, test, severity, title, description] = rest;
    const report = defectReportOf({ title, severity, description, test: { path, title: test } });
    return typeof report === "string" ? report : { name: "defects", action: "report", report };
  }
  const move = Object.hasOwn(MOVES, action!) ? MOVES[action as keyof typeof MOVES] : undefined;
  if (move === undefined || rest.length !== 1) return USAGE;
  return { name: "defects", action: "change", id: rest[0]!, status: move };
}
