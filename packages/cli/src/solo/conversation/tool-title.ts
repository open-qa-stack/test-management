import { isRecord } from "@open-qa-stack/domain";

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
  return typeof name === "string" ? name : typeof text === "string" ? text : "an element";
}

/** What a browser tool types: a text, or a field of a test account, which is never shown. */
function typed(args: unknown): string {
  const value = isRecord(args) ? args["value"] : undefined;
  if (typeof value === "string") return `"${value}"`;
  if (!isRecord(value)) return "a value";
  return `the ${String(value["field"])} of the account ${String(value["account"])}`;
}

/** How many items a list of the arguments holds, with what they are. */
function counted(args: unknown, name: string, one: string): string {
  const list = isRecord(args) ? args[name] : undefined;
  const count = Array.isArray(list) ? list.length : 0;
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

/** How a tool call reads, by the end of the name of the tool; `source` is what the name starts with. */
const TITLES: readonly (readonly [RegExp, (source: string, args: unknown) => string])[] = [
  [/_goto$/, (source, args) => `Opened ${argument(args, "url")} in ${source}`],
  [/_click$/, (source, args) => `Clicked "${target(args)}" in ${source}`],
  [/_fill$/, (_source, args) => `Typed ${typed(args)} in "${target(args)}"`],
  [/_select_option$/, (_source, args) => `Chose "${argument(args, "option")}"`],
  [/_check$/, (_source, args) => `Checked "${target(args)}"`],
  [/_snapshot$/, (source) => `Looked at the page of ${source}`],
  [/_screenshot$/, (source) => `Captured the screen of ${source}`],
  [/_db_list_tables$/, (source) => `Listed the tables of ${source}`],
  [/_db_describe_table$/, (_source, args) => `Described the table ${argument(args, "table")}`],
  [/_db_sample_rows$/, (_source, args) => `Read rows of the table ${argument(args, "table")}`],
  [/_api_list_operations$/, (source) => `Listed the operations of the API of ${source}`],
  [/_api_read_operation$/, (_source, args) => `Read the operation ${argument(args, "method")} ${argument(args, "path")}`],
  [/_list_files$/, (source) => `Listed the files of ${source}`],
  [/_read_file$/, (source, args) => `Read ${argument(args, "path") || `a file of ${source}`}`],
  [/_read_section$/, (source, args) => `Read section ${argument(args, "number")} of ${argument(args, "file") || source}`],
  [/^knowledge_domain$/, (_source, args) => `Read the domain ${argument(args, "domain")}`],
  [/^knowledge_list$/, (_source, args) => `Searched the knowledge: ${argument(args, "words")}`],
  [/^knowledge_read$/, (_source, args) => `Read ${argument(args, "item")}`],
  [/^tests_list$/, () => "Looked for the existing tests"],
  [/^tests_read$/, (_source, args) => `Read the test ${argument(args, "path")}`],
  [/^propose_plan$/, (_source, args) => `Proposed a plan of ${counted(args, "scenarios", "scenario")}`],
  [/^run_test$/, () => "Ran the test"],
  [/^propose_test$/, () => "Handed in the test"],
  [/^report_duplicates$/, (_source, args) => `Reported ${counted(args, "duplicates", "duplicate")}`],
  [/^report_findings$/, (_source, args) => `Reported ${counted(args, "findings", "coherence finding")}`],
  [/^report_quality$/, (_source, args) => `Reported ${counted(args, "findings", "remark")} on the code`],
  [/^remember$/, () => "Noted something for later"],
  [/^recall$/, () => "Read what was noted"],
  [/^write_domain$/, (_source, args) => `Wrote the domain ${argument(args, "id")}`],
  [/^submit_index$/, (_source, args) => `Handed in an index of ${counted(args, "domains", "domain")}`],
];

/**
 * Says what a tool call did, as the thread of a session reads in a terminal.
 *
 * @param tool - The name of the tool, such as `customer_self_service_click`.
 * @param args - Its arguments.
 * @returns A sentence in the past tense, such as `Clicked "Log in" in customer-self-service`; the name of the
 * tool and its arguments for a tool the command does not know. A value typed from a test account is named,
 * never shown.
 */
export function toolTitle(tool: string, args: unknown): string {
  const known = TITLES.find(([end]) => end.test(tool));
  if (known === undefined) return `${tool} ${JSON.stringify(args ?? {})}`;
  const [end, title] = known;
  return title(tool.replace(end, "").replace(/_/g, "-"), args);
}
