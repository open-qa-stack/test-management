import type { Command, ConfigAction } from "./command.ts";

/** What `oqas config` is followed by. */
const CONFIG_ACTIONS: readonly ConfigAction[] = ["show", "import", "export", "history", "check"];

/** What `oqas config` asks for, or why it is refused: one action, and nothing of a session. */
export function configured(words: readonly string[], ofASession: boolean): Command | string {
  const [action] = words;
  const known = CONFIG_ACTIONS.find((one) => one === action);
  if (words.length !== 1 || known === undefined) return "oqas config takes show, import, export, history or check.";
  if (ofASession) return "oqas config acts on the configuration: it takes no --brief, --environment nor --follow.";
  return { name: "config", action: known };
}
