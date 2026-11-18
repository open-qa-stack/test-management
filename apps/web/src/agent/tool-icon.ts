import type { IconName } from "../ui/icon.tsx";
import { BROWSER_TOOL } from "./browser-tool.ts";

/**
 * Draws a tool after what it works on.
 *
 * @param tool - The name of the tool, such as `customer_self_service_click`.
 * @returns The icon of a test that runs, a plan, a test that is written, a browser, a database or a document; that of code for any other.
 */
export function iconOf(tool: string): IconName {
  if (/run_test/.test(tool)) return "play";
  if (/propose_plan|report_duplicates|tests_list/.test(tool)) return "layers";
  if (/propose_test|tests_read/.test(tool)) return "pen";
  if (BROWSER_TOOL.test(tool)) return "web";
  if (/db|sql|query/.test(tool)) return "database";
  if (/knowledge|search|read|outline|list/.test(tool)) return "document";
  return "code";
}
