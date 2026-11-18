import { isRecord } from "@open-qa-stack/domain";
import { t } from "./i18n/i18n.ts";

/** Reads a field of the arguments of a tool call as a text; empty when it has none. */
function argument(args: unknown, name: string): string {
  const value = isRecord(args) ? args[name] : undefined;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The name of the element a browser tool acts on. */
function target(args: unknown): string {
  const named = isRecord(args) && isRecord(args["target"]) ? args["target"] : {};
  const { name, text } = named;
  return typeof name === "string" ? name : typeof text === "string" ? text : t("tools.anElement");
}

/** What a browser tool types: a text, or a field of a test account, which is never shown. */
function typed(args: unknown): string {
  const value = isRecord(args) ? args["value"] : undefined;
  if (typeof value === "string") return t("tools.typedText", { value });
  if (!isRecord(value)) return t("tools.aValue");
  return t("tools.typedAccount", { part: String(value["field"]), account: String(value["account"]) });
}

/** How many items a list of the arguments holds. */
function count(args: unknown, name: string): number {
  const list = isRecord(args) ? args[name] : undefined;
  return Array.isArray(list) ? list.length : 0;
}

/** How a tool call reads, by the end of the name of the tool; `source` is what the name starts with, `subject` the test the call is about. */
const TITLES: readonly (readonly [RegExp, (source: string, args: unknown, subject: string | undefined) => string])[] = [
  [/_goto$/, (source, args) => t("tools.goto", { url: argument(args, "url"), source })],
  [/_click$/, (source, args) => t("tools.click", { target: target(args), source })],
  [/_fill$/, (_source, args) => t("tools.fill", { value: typed(args), target: target(args) })],
  [/_select_option$/, (_source, args) => t("tools.selectOption", { option: argument(args, "option") })],
  [/_check$/, (_source, args) => t("tools.check", { target: target(args) })],
  [/_snapshot$/, (source) => t("tools.snapshot", { source })],
  [/_screenshot$/, (source) => t("tools.screenshot", { source })],
  [/_db_list_tables$/, (source) => t("tools.listTables", { source })],
  [/_db_describe_table$/, (_source, args) => t("tools.describeTable", { table: argument(args, "table") })],
  [/_db_sample_rows$/, (_source, args) => t("tools.sampleRows", { table: argument(args, "table") })],
  [/_api_list_operations$/, (source) => t("tools.listOperations", { source })],
  [/_api_read_operation$/, (_source, args) => t("tools.readOperation", { method: argument(args, "method"), path: argument(args, "path") })],
  [/_list_files$/, (source) => t("tools.listFiles", { source })],
  [/_read_file$/, (source, args) => t("tools.readFile", { path: argument(args, "path") || t("tools.aFileOf", { source }) })],
  [/_read_section$/, (source, args) => t("tools.readSection", { number: argument(args, "number"), file: argument(args, "file") || source })],
  [/^knowledge_domain$/, (_source, args) => t("tools.knowledgeDomain", { domain: argument(args, "domain") })],
  [/^knowledge_list$/, (_source, args) => t("tools.knowledgeList", { words: argument(args, "words") })],
  [/^knowledge_read$/, (_source, args) => t("tools.knowledgeRead", { item: argument(args, "item") })],
  [/^tests_list$/, () => t("tools.testsList")],
  [/^tests_read$/, (_source, args) => t("tools.testsRead", { path: argument(args, "path") })],
  [/^propose_plan$/, (_source, args) => t("tools.proposePlan", { count: count(args, "scenarios") })],
  [/^run_test$/, (_source, _args, subject) => (subject === undefined ? t("tools.runTest") : t("tools.runNamedTest", { subject }))],
  [/^propose_test$/, (_source, _args, subject) => (subject === undefined ? t("tools.proposeTest") : t("tools.proposeNamedTest", { subject }))],
  [/^report_duplicates$/, (_source, args) => t("tools.reportDuplicates", { count: count(args, "duplicates") })],
  [/^report_findings$/, (_source, args) => t("tools.reportFindings", { count: count(args, "findings") })],
  [/^report_quality$/, (_source, args) => t("tools.reportQuality", { count: count(args, "findings") })],
  [/^remember$/, () => t("tools.remember")],
  [/^recall$/, () => t("tools.recall")],
  [/^write_domain$/, (_source, args) => t("tools.writeDomain", { id: argument(args, "id") })],
  [/^submit_index$/, (_source, args) => t("tools.submitIndex", { count: count(args, "domains") })],
];

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
  const known = TITLES.find(([end]) => end.test(tool));
  if (known === undefined) return `${tool} ${JSON.stringify(args ?? {})}`;
  const [end, title] = known;
  return title(tool.replace(end, "").replace(/_/g, "-"), args, subject);
}
