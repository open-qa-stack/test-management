import { toolTitle as toldTool } from "@open-qa-stack/domain/sessions";
import { t } from "./i18n/i18n.ts";

/**
 * Says what a tool call did, as the thread of a session reads in a terminal.
 *
 * @param tool - The name of the tool, such as `customer_self_service_click`.
 * @param args - Its arguments.
 * @param subject - The test the call is about, when the agent handed the tool the file of one.
 * @returns A sentence in the past tense, such as `Clicked "Log in" in customer-self-service`; the name of the
 * tool and its arguments for a tool the command does not know. A value typed from a test account is named,
 * never shown.
 */
export function toolTitle(tool: string, args: unknown, subject?: string): string {
  return toldTool(tool, args, subject, (word, values) => t(`tools.${word}`, values ?? {}));
}
