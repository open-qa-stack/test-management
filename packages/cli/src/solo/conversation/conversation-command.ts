import { parseArguments } from "../arguments.ts";
import { isPrinting, type PrintingCommand } from "../operation-commands.ts";
import { t } from "./i18n/i18n.ts";

/** What the words typed after a slash ask the command for: one that prints, or why the conversation refuses them. */
export type ConversationCommand = { readonly ok: true; readonly command: PrintingCommand } | { readonly ok: false; readonly why: string };

/**
 * Reads the words typed after a slash as the arguments of the command, so that the conversation runs what the command
 * runs, with the same words.
 *
 * @param argv - The arguments of the command the words stand for, as `oqas` would be given them.
 * @returns The command, when it is one that prints and asks nothing typed; why it is refused otherwise: what the
 * command refuses, an option of where it runs or how it prints, which the conversation sets, or a value to type,
 * which the conversation would show.
 */
export function conversationCommandOf(argv: readonly string[]): ConversationCommand {
  const parsed = parseArguments(argv);
  if (!parsed.ok) return { ok: false, why: parsed.error };
  const { repository, output, follow, command } = parsed.arguments;
  if (repository !== undefined || output !== "text" || follow) return { ok: false, why: t("requests.options") };
  if (!isPrinting(command)) return { ok: false, why: t("requests.notHere", { command: argv.join(" ") }) };
  if (command.name === "secrets" && command.action === "set") return { ok: false, why: t("requests.typedValue", { variable: command.variable }) };
  return { ok: true, command };
}
