import type { Command } from "./command.ts";

/** What `oqas applications` asks for, or why it is refused: the test of the addresses, of every application or of one. */
export function applicationsOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, application, ...rest] = words;
  if (ofASession) return "oqas applications acts on the applications of the configuration: it takes no --brief, --environment nor --follow.";
  if (action === "check" && rest.length === 0) return { name: "applications", action, ...(application === undefined ? {} : { application }) };
  return "oqas applications takes check, and an application at most.";
}
