import { counted } from "../ui/counted.ts";

/** Reads a field of the arguments of a tool call as a text; empty when it has none. */
function argument(args: unknown, name: string): string {
  const value = (args as Readonly<Record<string, unknown>> | null | undefined)?.[name];
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The name of the element a browser tool acts on. */
function target(args: unknown): string {
  const named = (args as { target?: { name?: unknown; text?: unknown } } | null | undefined)?.target;
  return typeof named?.name === "string" ? named.name : typeof named?.text === "string" ? named.text : "un élément";
}

/** What a browser tool types: a text, or a field of a test account, which is never shown. */
function typed(args: unknown): string {
  const value = (args as { value?: unknown } | null | undefined)?.value;
  if (typeof value === "string") return `« ${value} »`;
  if (typeof value !== "object" || value === null) return "une valeur";
  const { account, field: part } = value as { account?: unknown; field?: unknown };
  return `le champ ${String(part)} du compte ${String(account)}`;
}

/** How many items a list of the arguments holds. */
function count(args: unknown, name: string): number {
  const list = (args as Readonly<Record<string, unknown>> | null | undefined)?.[name];
  return Array.isArray(list) ? list.length : 0;
}

/** How a tool call reads, by the end of the name of the tool; `source` is what the name starts with, `subject` the test the call is about. */
const TITLES: readonly (readonly [RegExp, (source: string, args: unknown, subject: string | undefined) => string])[] = [
  [/_goto$/, (source, args) => `A ouvert ${argument(args, "url")} dans ${source}`],
  [/_click$/, (source, args) => `A cliqué sur « ${target(args)} » dans ${source}`],
  [/_fill$/, (_source, args) => `A saisi ${typed(args)} dans « ${target(args)} »`],
  [/_select_option$/, (_source, args) => `A choisi « ${argument(args, "option")} »`],
  [/_check$/, (_source, args) => `A coché « ${target(args)} »`],
  [/_snapshot$/, (source) => `A regardé la page de ${source}`],
  [/_screenshot$/, (source) => `A capturé l’écran de ${source}`],
  [/_db_list_tables$/, (source) => `A listé les tables de ${source}`],
  [/_db_describe_table$/, (_source, args) => `A décrit la table ${argument(args, "table")}`],
  [/_db_sample_rows$/, (_source, args) => `A lu des lignes de la table ${argument(args, "table")}`],
  [/_api_list_operations$/, (source) => `A listé les opérations de l’API de ${source}`],
  [/_api_read_operation$/, (_source, args) => `A lu l’opération ${argument(args, "method")} ${argument(args, "path")}`],
  [/_list_files$/, (source) => `A listé les fichiers de ${source}`],
  [/_read_file$/, (_source, args) => `A lu ${argument(args, "path")}`],
  [/_read_section$/, (_source, args) => `A lu ${argument(args, "file")} § ${argument(args, "number")}`],
  [/^knowledge_domain$/, (_source, args) => `A lu le domaine ${argument(args, "domain")}`],
  [/^knowledge_list$/, (_source, args) => `A cherché dans les connaissances : ${argument(args, "words")}`],
  [/^knowledge_read$/, (_source, args) => `A lu ${argument(args, "item")}`],
  [/^tests_list$/, () => "A cherché les tests existants"],
  [/^tests_read$/, (_source, args) => `A lu le test ${argument(args, "path")}`],
  [/^propose_plan$/, (_source, args) => `A proposé un plan de ${counted(count(args, "scenarios"), "scénario", "scénarios")}`],
  [/^run_test$/, (_source, _args, subject) => (subject === undefined ? "A joué le test" : `A joué « ${subject} »`)],
  [/^propose_test$/, (_source, _args, subject) => (subject === undefined ? "A remis le test" : `A remis « ${subject} »`)],
  [/^report_duplicates$/, (_source, args) => `A signalé ${counted(count(args, "duplicates"), "doublon", "doublons")}`],
  [/^report_findings$/, (_source, args) => `A rendu ${counted(count(args, "findings"), "constat", "constats")} de cohérence`],
  [/^report_quality$/, (_source, args) => `A rendu ${counted(count(args, "findings"), "remarque", "remarques")} sur le code`],
  [/^remember$/, () => "A noté quelque chose pour la suite"],
];

/**
 * Says what a tool call did, as the thread of a session reads.
 *
 * @param tool - The name of the tool, such as `customer_self_service_click`.
 * @param args - Its arguments.
 * @param subject - The test the call is about, when the agent handed the tool the file of one.
 * @returns A sentence in the past tense, such as « A cliqué sur « Log in » dans customer-self-service »; the
 * name of the tool and its arguments for a tool the console does not know. A value typed from a test account
 * is named, never shown.
 */
export function toolTitle(tool: string, args: unknown, subject?: string): string {
  const known = TITLES.find(([end]) => end.test(tool));
  if (known === undefined) return `${tool} ${JSON.stringify(args ?? {})}`;
  const [end, title] = known;
  return title(tool.replace(end, "").replace(/_/g, "-"), args, subject);
}
