import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent, AgentRuntime } from "@open-qa-stack/domain";
import { validateSourceCard, type Knowledge, type ResolvedConfig, type SourceCard } from "@open-qa-stack/shared";
import { knowledgeInventory, knowledgeTools, scopedToolName, type KnowledgeAccess } from "@open-qa-stack/tools";
import { agentNotes } from "../common/agent-notes.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { HandedIn } from "../common/handed-in.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { cardRules } from "./card-rules.ts";
import { SOURCE_CARTOGRAPHER_INSTRUCTIONS, sourceCardRequest } from "./source-cartographer-prompt.ts";

/** Folder of the cards, in the index folder of the test repository. */
export const CARDS_FOLDER = "sources";
/** Tools of a database that read rows: the cartographer of a source reads the catalog only. */
const DATA_TOOLS = ["sample_rows", "search", "query"];

/** What the cartography of one source needs. */
export interface SourceCartographerOptions {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** The knowledge source to map. */
  readonly source: Knowledge;
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The runtime that opens the agent's session. */
  readonly runtime: AgentRuntime;
  /** Makes the SQL client of a database; PostgreSQL by default. */
  readonly sqlClient?: KnowledgeAccess["sqlClient"];
  /** Maps the source again even when its card is up to date. */
  readonly force?: boolean;
  /** The clock of the card date; the system clock by default. */
  readonly now?: () => Date;
}

/** What the cartography of one source produced. */
export interface SourceCartographyOutcome {
  /** Where the card is, when it was written or kept. */
  readonly cardPath?: string;
  /** The card written or kept. */
  readonly card?: SourceCard;
  /** Whether an up-to-date card was kept rather than made again. */
  readonly kept: boolean;
  /** What the run checked, refused and wrote. */
  readonly journal: readonly JournalEntry[];
}

/**
 * The cartographer of one knowledge source: it writes the card of the source, its elements grouped by
 * functional domain, in the test repository.
 *
 * @remarks
 * The harness reads the inventory of the source without the model — its elements, their structural facts
 * and its fingerprint. A card whose fingerprint is the source's, and that is complete, is kept as it is.
 * Otherwise the agent gets the tools of this source only — the catalog of a base, never its rows — and
 * hands its card in with `submit_card`, which must place every element and invent none. The facts read by
 * the harness are joined to the card before it is written. Nothing is committed nor pushed.
 */
export class SourceCartographer {
  private readonly options: SourceCartographerOptions;

  /** @param options - What the cartography needs. */
  public constructor(options: SourceCartographerOptions) {
    this.options = options;
  }

  /**
   * Maps the source, unless its card is up to date.
   *
   * @returns The card, written or kept, and the journal.
   * @throws Error when the card cannot be written to the disk.
   */
  public async run(): Promise<SourceCartographyOutcome> {
    const { config, source, repositoryRoot, env } = this.options;
    const journal = new Journal();
    const access = { repositoryRoot, env, ...(this.options.sqlClient === undefined ? {} : { sqlClient: this.options.sqlClient }) };
    const cardPath = join(repositoryRoot, config.repository.indexDir, CARDS_FOLDER, `${source.id}.json`);
    let inventory;
    try {
      inventory = await knowledgeInventory(source, access);
    } catch (failure) {
      journal.record("error", `The source ${source.id} does not answer: ${failure instanceof Error ? failure.message : String(failure)}`, source.id);
      return { kept: false, journal: journal.entries() };
    }
    if (inventory === undefined) {
      journal.record("error", `No card is made yet for a ${source.type} source.`, source.id);
      return { kept: false, journal: journal.entries() };
    }
    const existing = await upToDate(cardPath, inventory.fingerprint);
    if (existing !== undefined && this.options.force !== true) {
      journal.record("info", `The card of ${source.id} is up to date; it was kept.`, source.id);
      return { cardPath, card: existing, kept: true, journal: journal.entries() };
    }
    const submission = new HandedIn(cardRules(source.id, inventory), journal);
    const tools = knowledgeTools([source], access).filter((tool) => !(source.type === "postgresql" && DATA_TOOLS.some((action) => tool.name === scopedToolName(source.id, action))));
    const events: AgentEvent[] = [];
    const now = this.options.now ?? (() => new Date());
    const notes = agentNotes(config, repositoryRoot, env, { role: "cartographer", task: `card-${source.id}-${now().toISOString()}`, now });
    const task = { instructions: SOURCE_CARTOGRAPHER_INSTRUCTIONS, tools: [...tools, ...notes, submission.tool()], request: sourceCardRequest(source.id, source.type, inventory), events, reminder: () => submission.reminder() };
    await runAgentTask(this.options.runtime, task, taskLimits(config));
    for (const event of events) if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`, source.id);
    const { last, counters } = taskEnd(events);
    if (last.type === "error") journal.record("error", `The session failed: ${last.error.message}`, source.id);
    if (last.type === "stopped") journal.record("error", `The task reached its ${last.reason.limit} limit.`, source.id);
    const accepted = submission.accepted;
    if (accepted === undefined) {
      journal.record("error", "No card was written: no card was accepted before the session ended.", source.id);
      return { kept: false, journal: journal.entries() };
    }
    const card: SourceCard = {
      formatVersion: 1,
      source: { id: source.id, type: source.type },
      fingerprint: inventory.fingerprint,
      producedAt: now().toISOString(),
      model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
      run: { iterations: counters.iterations, actions: counters.actions, durationMs: Math.round(counters.elapsedMs) },
      status: last.type === "end" ? "complete" : "truncated",
      domains: accepted.domains.map((domain) => ({ ...domain, items: domain.items.map((item) => ({ ...item, facts: { ...inventory.facts.get(item.name) } })) })),
      unassigned: accepted.unassigned,
    };
    const validation = validateSourceCard(card);
    if (!validation.ok) {
      for (const error of validation.errors) journal.record("error", `The card does not match its schema: ${error.message}`, source.id);
      journal.record("error", "No card was written.", source.id);
      return { kept: false, journal: journal.entries() };
    }
    await mkdir(dirname(cardPath), { recursive: true });
    await writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`);
    journal.record("info", `The card was written to ${cardPath}, ${card.status}.`, source.id);
    return { cardPath, card, kept: false, journal: journal.entries() };
  }
}

/** The card at `path`, when it is readable, complete, and its fingerprint is `fingerprint`. */
async function upToDate(path: string, fingerprint: string): Promise<SourceCard | undefined> {
  const content = await readFile(path, "utf8").then(
    (text) => JSON.parse(text) as unknown,
    () => undefined,
  ).catch(() => undefined);
  const validation = validateSourceCard(content);
  return validation.ok && validation.value.fingerprint === fingerprint && validation.value.status === "complete" ? validation.value : undefined;
}
