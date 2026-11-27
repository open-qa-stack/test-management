import { lessonDraftOf, memoryChangeOf } from "@open-qa-stack/domain";
import type { Command } from "./command.ts";

/** What `oqas memory` takes after it, for what it is asked. */
const USAGE =
  "oqas memory takes nothing; add then design, discovery or all, project or the identifier of an application, and the instruction; on or off then the identifier of a line; or reword then the identifier and what it says now.";

/**
 * What `oqas memory` asks for, or why it is refused: the lines of the memory of the agents; an instruction added, for a
 * work and to the project or an application; a line set to apply or set aside, or reworded, by its identifier; and
 * nothing of a session.
 */
export function memoryOf(words: readonly string[], ofASession: boolean): Command | string {
  if (ofASession) return "oqas memory acts on the memory of the agents: it takes no --brief, --environment nor --follow.";
  if (words.length === 0) return { name: "memory", action: "list" };
  const [action, first, second, ...rest] = words;
  if (action === "add" && second !== undefined && rest.length > 0) {
    const draft = lessonDraftOf({ target: first, ...(second === "project" ? {} : { application: second }), text: rest.join(" ") });
    return typeof draft === "string" ? draft : { name: "memory", action: "add", draft };
  }
  if ((action === "on" || action === "off") && first !== undefined && second === undefined)
    return { name: "memory", action: "change", id: first, change: { active: action === "on" } };
  if (action === "reword" && first !== undefined && second !== undefined) {
    const change = memoryChangeOf({ text: [second, ...rest].join(" ") });
    return typeof change === "string" ? change : { name: "memory", action: "change", id: first, change };
  }
  return USAGE;
}
