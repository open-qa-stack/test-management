import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentRuntime, ToolDefinition } from "@open-qa-stack/domain";
import { validateDomainIndex, type DomainIndex, type IndexSource, type ResolvedConfig } from "@open-qa-stack/shared";
import { browserTools, knowledgeTools, scopedToolName, type BrowserAccess, type KnowledgeAccess } from "@open-qa-stack/tools";
import { CARTOGRAPHER_INSTRUCTIONS, cartographyRequest } from "./cartographer-prompt.ts";
import { agentNotes } from "../common/agent-notes.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { HandedIn } from "../common/handed-in.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { domainIndexRules } from "./domain-index-rules.ts";
import { runSources, type RunSource } from "./run-sources.ts";
import { surveySource } from "./source-survey.ts";

/** Name of the index file, in the index folder of the test repository. */
export const INDEX_FILE_NAME = "domain-index.json";
/** Tools of a database that read rows: the cartographer reads the catalog only. */
const DATA_TOOLS = ["sample_rows", "search", "query"];

/** What a cartography needs. */
export interface CartographerOptions {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** Name of the environment explored. */
  readonly environment: string;
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings and credentials the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The runtime that opens the agent's session. */
  readonly runtime: AgentRuntime;
  /** Makes the SQL client of a database; PostgreSQL by default. */
  readonly sqlClient?: KnowledgeAccess["sqlClient"];
  /** How the browser starts and waits; a headless Chromium with the default waits otherwise. */
  readonly browser?: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs">;
  /** The clock of the index date; the system clock by default. */
  readonly now?: () => Date;
}

/** What a cartography produced. */
export interface CartographyOutcome {
  /** Where the index was written, when it was. */
  readonly indexPath?: string;
  /** The index written, when it was. */
  readonly index?: DomainIndex;
  /** What the run checked, refused and wrote. */
  readonly journal: readonly JournalEntry[];
}

/**
 * The cartographer: it reads the sources the configuration declares and writes an index of the
 * application's functional domains in the test repository.
 *
 * @remarks
 * Before any exploration, every source must answer; otherwise no session starts and no index is written.
 * The harness then reads, without the model, the tags of each contract and the tables of each base, which
 * every domain index must place. The agent explores with the tools of the sources — the catalog of a
 * base only, never its rows — and of the user interfaces, under the limits of the configured autonomy, and
 * hands its index in with `submit_index`. The index is written only once a submission was accepted and the
 * whole index passes its schema; it is `truncated` when a limit stopped the task or a source was not read.
 * Nothing is committed nor pushed.
 */
export class Cartographer {
  private readonly options: CartographerOptions;

  /** @param options - What the cartography needs. */
  public constructor(options: CartographerOptions) {
    this.options = options;
  }

  /**
   * Runs a cartography.
   *
   * @returns The index written, if any, and the journal.
   * @throws Error when the index cannot be written to the disk.
   */
  public async run(): Promise<CartographyOutcome> {
    const { config, environment, repositoryRoot, env } = this.options;
    const journal = new Journal();
    const sources = runSources(config, environment);
    const knowledge = knowledgeTools(
      sources.flatMap((source) => (source.type === "web" ? [] : [source.knowledge])),
      { repositoryRoot, env, ...(this.options.sqlClient === undefined ? {} : { sqlClient: this.options.sqlClient }) },
    ).filter((tool) => !isDataTool(tool, sources));
    const access = { repositoryRoot, env, ...(this.options.sqlClient === undefined ? {} : { sqlClient: this.options.sqlClient }) };
    const surveys = await Promise.all(sources.map(async (source) => [source, await surveySource(source, access)] as const));
    const failures = surveys.flatMap(([source, survey]) => (survey.ok ? [] : [[source, survey.error] as const]));
    for (const [source, error] of failures) journal.record("error", `The source ${source.id} does not answer: ${error}`, source.id);
    if (failures.length > 0) {
      journal.record("error", "No index was written: every declared source must answer before the exploration.");
      return { journal: journal.entries() };
    }
    const inventory = new Map(surveys.flatMap(([source, survey]) => (survey.ok && survey.inventory !== undefined ? [[source.id, survey.inventory.items] as const] : [])));
    const events: AgentEvent[] = [];
    const isRead = (id: string) => inventory.has(id) || readSources(sources, events).has(id);
    const submission = new HandedIn(domainIndexRules(inventory, new Set(sources.map((source) => source.id)), isRead), journal);
    const browser = browserTools(config.applications, { environment, env, screenshotsDir: join(repositoryRoot, config.repository.stateDir, "screenshots"), ...this.options.browser });
    const now = this.options.now ?? (() => new Date());
    const notes = agentNotes(config, repositoryRoot, env, { role: "cartographer", task: `index-${environment}-${now().toISOString()}`, now });
    const task = { instructions: CARTOGRAPHER_INSTRUCTIONS, tools: [...knowledge, ...browser.tools, ...notes, submission.tool()], request: cartographyRequest(environment, sources, inventory), events, reminder: () => submission.reminder() };
    await runAgentTask(this.options.runtime, task, taskLimits(config)).finally(() => browser.close());
    for (const event of events) if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`);
    const { last, counters } = taskEnd(events);
    const accepted = submission.accepted;
    if (last.type === "error") journal.record("error", `The session failed: ${last.error.message}`);
    if (last.type === "stopped") journal.record("error", `The task reached its ${last.reason.limit} limit.`);
    if (accepted === undefined) {
      journal.record("error", "No index was written: no index was accepted before the session ended.");
      return { journal: journal.entries() };
    }
    const states = sources.map((source): IndexSource => ({ id: source.id, type: source.type, state: isRead(source.id) ? "read" : "not_read" }));
    const index: DomainIndex = {
      formatVersion: 1,
      producedAt: now().toISOString(),
      environment,
      model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
      run: { iterations: counters.iterations, actions: counters.actions, durationMs: Math.round(counters.elapsedMs) },
      status: last.type !== "end" || states.some((s) => s.state === "not_read") ? "truncated" : "complete",
      sources: states,
      ...accepted,
    };
    return this.write(index, journal);
  }

  private async write(index: DomainIndex, journal: Journal): Promise<CartographyOutcome> {
    const validation = validateDomainIndex(index);
    if (!validation.ok) {
      for (const error of validation.errors) journal.record("error", `The index does not match its schema: ${error.message}`);
      journal.record("error", "No index was written.");
      return { journal: journal.entries() };
    }
    const folder = join(this.options.repositoryRoot, this.options.config.repository.indexDir);
    const indexPath = join(folder, INDEX_FILE_NAME);
    await mkdir(folder, { recursive: true });
    await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`);
    journal.record("info", `The index was written to ${indexPath}, ${index.status}.`);
    return { indexPath, index, journal: journal.entries() };
  }
}

/** Whether a tool reads the rows of a database the run declares. */
function isDataTool(tool: ToolDefinition, sources: readonly RunSource[]): boolean {
  return sources.some((source) => source.type === "postgresql" && DATA_TOOLS.some((action) => tool.name === scopedToolName(source.id, action)));
}

/** Tools that read a document or source code, rather than only list what it holds. */
const READING_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  document: ["read_section"],
  "source-code": ["search", "read_file", "outline", "git_log", "git_blame", "git_show", "run_command"],
};

/**
 * The sources the agent has read: a user interface whose tools answered, a document or source code whose
 * reading tools answered, a result that is an error not counting. A tool belongs to the source whose
 * identifier gives the longest prefix of its name, so that `shop_admin_goto` belongs to `shop-admin`
 * rather than to `shop`.
 */
function readSources(sources: readonly RunSource[], events: readonly AgentEvent[]): Set<string> {
  const prefixes = sources.map((source) => [scopedToolName(source.id, ""), source] as const).sort(([a], [b]) => b.length - a.length);
  const read = new Set<string>();
  for (const event of events) {
    if (event.type !== "tool-result" || isRefusal(event.result)) continue;
    const owner = prefixes.find(([prefix]) => event.tool.startsWith(prefix));
    if (owner === undefined) continue;
    const [prefix, source] = owner;
    const reading = READING_ACTIONS[source.type];
    if (reading === undefined || reading.includes(event.tool.slice(prefix.length))) read.add(source.id);
  }
  return read;
}

function isRefusal(result: unknown): boolean {
  return typeof result === "object" && result !== null && "error" in result;
}
