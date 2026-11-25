import type { Command } from "./command.ts";

/** What `oqas secrets` asks for, or why it is refused: the list, or the value of one variable, and nothing of a session. */
export function secretsOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, variable, ...rest] = words;
  if (ofASession) return "oqas secrets acts on the values of the variables: it takes no --brief, --environment nor --follow.";
  if (action === undefined) return { name: "secrets", action: "list" };
  if (action !== "set" || variable === undefined || rest.length > 0)
    return "oqas secrets takes nothing, to list the variables, or set then the variable: its value is read from the input, never from the arguments.";
  return { name: "secrets", action, variable };
}
