import { isRecord } from "../../json.ts";

/** Each sentence a tool call is told with, and each part of one, by the key a presentation words it under. */
export type ToolWord =
  | "anElement"
  | "typedText"
  | "aValue"
  | "typedAccount"
  | "goto"
  | "click"
  | "fill"
  | "selectOption"
  | "check"
  | "snapshot"
  | "screenshot"
  | "listTables"
  | "describeTable"
  | "sampleRows"
  | "listOperations"
  | "readOperation"
  | "listFiles"
  | "readFile"
  | "aFileOf"
  | "readSection"
  | "knowledgeDomain"
  | "knowledgeList"
  | "knowledgeRead"
  | "testsList"
  | "testsRead"
  | "proposePlan"
  | "runTest"
  | "runNamedTest"
  | "proposeTest"
  | "proposeNamedTest"
  | "reportDuplicates"
  | "reportFindings"
  | "reportQuality"
  | "remember"
  | "recall"
  | "writeDomain"
  | "submitIndex";

/**
 * How a presentation words a sentence of a tool call, or a part of one.
 *
 * @param word - The key of the sentence.
 * @param values - What it names; `count` for one said in the singular or the plural.
 * @returns The sentence, in the language of the presentation.
 */
export type ToolWording = (word: ToolWord, values?: Readonly<Record<string, string | number>>) => string;

/** Reads a field of the arguments of a tool call as a text; empty when it has none. */
function argument(args: unknown, name: string): string {
  const value = isRecord(args) ? args[name] : undefined;
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The name of the element a browser tool acts on. */
function target(args: unknown, say: ToolWording): string {
  const named = isRecord(args) && isRecord(args["target"]) ? args["target"] : {};
  const { name, text } = named;
  return typeof name === "string" ? name : typeof text === "string" ? text : say("anElement");
}

/** What a browser tool types: a text, or a field of a test account, which is never shown. */
function typed(args: unknown, say: ToolWording): string {
  const value = isRecord(args) ? args["value"] : undefined;
  if (typeof value === "string") return say("typedText", { value });
  if (!isRecord(value)) return say("aValue");
  return say("typedAccount", { part: String(value["field"]), account: String(value["account"]) });
}

/** How many items a list of the arguments holds. */
function count(args: unknown, name: string): number {
  const list = isRecord(args) ? args[name] : undefined;
  return Array.isArray(list) ? list.length : 0;
}

/** A tool call as it is told: what the name of its tool starts with, its arguments, the test it is about, and how the presentation words it. */
interface Call {
  readonly source: string;
  readonly args: unknown;
  readonly subject: string | undefined;
  readonly say: ToolWording;
}

/** How a tool call reads, by the end of the name of the tool. */
const TITLES: readonly (readonly [RegExp, (call: Call) => string])[] = [
  [/_goto$/, ({ source, args, say }) => say("goto", { url: argument(args, "url"), source })],
  [/_click$/, ({ source, args, say }) => say("click", { target: target(args, say), source })],
  [/_fill$/, ({ args, say }) => say("fill", { value: typed(args, say), target: target(args, say) })],
  [/_select_option$/, ({ args, say }) => say("selectOption", { option: argument(args, "option") })],
  [/_check$/, ({ args, say }) => say("check", { target: target(args, say) })],
  [/_snapshot$/, ({ source, say }) => say("snapshot", { source })],
  [/_screenshot$/, ({ source, say }) => say("screenshot", { source })],
  [/_db_list_tables$/, ({ source, say }) => say("listTables", { source })],
  [/_db_describe_table$/, ({ args, say }) => say("describeTable", { table: argument(args, "table") })],
  [/_db_sample_rows$/, ({ args, say }) => say("sampleRows", { table: argument(args, "table") })],
  [/_api_list_operations$/, ({ source, say }) => say("listOperations", { source })],
  [/_api_read_operation$/, ({ args, say }) => say("readOperation", { method: argument(args, "method"), path: argument(args, "path") })],
  [/_list_files$/, ({ source, say }) => say("listFiles", { source })],
  [/_read_file$/, ({ source, args, say }) => say("readFile", { path: argument(args, "path") || say("aFileOf", { source }) })],
  [/_read_section$/, ({ source, args, say }) => say("readSection", { number: argument(args, "number"), file: argument(args, "file") || source })],
  [/^knowledge_domain$/, ({ args, say }) => say("knowledgeDomain", { domain: argument(args, "domain") })],
  [/^knowledge_list$/, ({ args, say }) => say("knowledgeList", { words: argument(args, "words") })],
  [/^knowledge_read$/, ({ args, say }) => say("knowledgeRead", { item: argument(args, "item") })],
  [/^tests_list$/, ({ say }) => say("testsList")],
  [/^tests_read$/, ({ args, say }) => say("testsRead", { path: argument(args, "path") })],
  [/^propose_plan$/, ({ args, say }) => say("proposePlan", { count: count(args, "scenarios") })],
  [/^run_test$/, ({ subject, say }) => (subject === undefined ? say("runTest") : say("runNamedTest", { subject }))],
  [/^propose_test$/, ({ subject, say }) => (subject === undefined ? say("proposeTest") : say("proposeNamedTest", { subject }))],
  [/^report_duplicates$/, ({ args, say }) => say("reportDuplicates", { count: count(args, "duplicates") })],
  [/^report_findings$/, ({ args, say }) => say("reportFindings", { count: count(args, "findings") })],
  [/^report_quality$/, ({ args, say }) => say("reportQuality", { count: count(args, "findings") })],
  [/^remember$/, ({ say }) => say("remember")],
  [/^recall$/, ({ say }) => say("recall")],
  [/^write_domain$/, ({ args, say }) => say("writeDomain", { id: argument(args, "id") })],
  [/^submit_index$/, ({ args, say }) => say("submitIndex", { count: count(args, "domains") })],
];

/**
 * Says what a tool call did, in the words of a presentation.
 *
 * @param tool - The name of the tool, such as `customer_self_service_click`.
 * @param args - Its arguments.
 * @param subject - The test the call is about, when the agent handed the tool the file of one.
 * @param say - How the presentation words each sentence.
 * @returns A sentence, such as `Clicked "Log in" in customer-self-service`; the name of the tool and its
 * arguments for a tool no sentence tells. A value typed from a test account is named, never shown.
 */
export function toolTitle(tool: string, args: unknown, subject: string | undefined, say: ToolWording): string {
  const known = TITLES.find(([end]) => end.test(tool));
  if (known === undefined) return `${tool} ${JSON.stringify(args ?? {})}`;
  const [end, title] = known;
  return title({ source: tool.replace(end, "").replace(/_/g, "-"), args, subject, say });
}
