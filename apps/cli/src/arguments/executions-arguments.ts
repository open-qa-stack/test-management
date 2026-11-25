import type { Command } from "./command.ts";

/** What `oqas executions` asks for, or why it is refused: a page of them, or one, and nothing of a session. */
export function executionsOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, execution, ...rest] = words;
  if (ofASession) return "oqas executions acts on the executions of tests: it takes no --brief, --environment nor --follow.";
  if (action === undefined) return { name: "executions", action: "list" };
  if (action !== "show" || execution === undefined || rest.length > 0) return "oqas executions takes nothing, to list them, or show then an execution.";
  return { name: "executions", action, execution };
}
