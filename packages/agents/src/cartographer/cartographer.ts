import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentEvent, AgentRuntime } from "@open-qa-stack/domain";
import { validateDomainIndex, type DomainIndex, type IndexSource, type ResolvedConfig, type SourceCard } from "@open-qa-stack/shared";
import type { BrowserAccess, KnowledgeAccess } from "@open-qa-stack/tools";
import { agentNotes } from "../common/agent-notes.ts";
import { configSecrets } from "../common/config-secrets.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { HandedIn } from "../common/handed-in.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { runTrace } from "../common/run-trace.ts";
import type { Trace } from "../common/trace.ts";
import type { PhaseOutcome, TraceLine } from "../common/trace-line.ts";
import { TracedPhases } from "../common/traced-phases.ts";
import { mapSources } from "../source-cartographer/sources-cartography.ts";
import { CARTOGRAPHER_INSTRUCTIONS, cartographyRequest } from "./cartographer-prompt.ts";
import { domainIndexRules } from "./domain-index-rules.ts";
import { runSources } from "./run-sources.ts";
import { surveySource } from "./source-survey.ts";

/** Name of the index file, in the index folder of the test repository. */
export const INDEX_FILE_NAME = "domain-index.json";

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
  /** The runtime that opens the agents' sessions. */
  readonly runtime: AgentRuntime;
  /** Makes the SQL client of a database; PostgreSQL by default. */
  readonly sqlClient?: KnowledgeAccess["sqlClient"];
  /** How the browser starts and waits; a headless Chromium with the default waits otherwise. */
  readonly browser?: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs">;
  /** Maps every source again, even those whose card is up to date. */
  readonly force?: boolean;
  /** Most sources mapped at once; one by default. */
  readonly concurrency?: number;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
  /** Receives each line of the trace as it is written, to follow the cartography while it runs. */
  readonly observe?: (line: TraceLine) => void;
}

/** What a cartography produced. */
export interface CartographyOutcome {
  /** Where the index was written, when it was. */
  readonly indexPath?: string;
  /** The index written, when it was. */
  readonly index?: DomainIndex;
  /** What the run checked, refused and wrote, the cartography of each source first. */
  readonly journal: readonly JournalEntry[];
  /** Where the trace of the cartography is written. */
  readonly tracePath: string;
}

/**
 * The cartographer: it writes an index of the application's functional domains in the test repository,
 * by consolidating the cards of the sources the configuration declares.
 *
 * @remarks
 * Before any exploration, every source must answer; otherwise no session starts and no index is written.
 * The inventory a knowledge source gave then is the one its card is made of: no source is read twice.
 * Each source without an up-to-date card is then mapped on its own, in its own task, under the limits of
 * the configured autonomy. A last task consolidates the cards, with the notes the agents kept but none of
 * the tools of the sources, and hands its index in with `submit_index`, which must place every element of
 * every card. A source without a card is `not_read`. The index is written only once a submission was
 * accepted and the whole index passes its schema; it is `truncated` when a limit stopped the consolidation,
 * a card is truncated or a source was not read. Nothing is committed nor pushed.
 *
 * The run is traced in `<stateDir>/traces/`, line by line, and each line is handed to `observe` as it is
 * written: the phases `survey`, `card`, `consolidation` and `index`, each from its `started` line to its
 * `finished` line even when the run throws, what the harness did in each, and every message, reasoning,
 * text and tool call of the agents.
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
   * @throws Error when a card or the index cannot be written to the disk.
   */
  public async run(): Promise<CartographyOutcome> {
    const now = this.options.now ?? (() => new Date());
    const trace = runTrace(this.options, `cartography-${this.options.environment}`, now);
    const phases = new TracedPhases(trace, "survey");
    const journal = new Journal((entry) => trace.harness(phases.current, { type: "journal", level: entry.level, message: entry.message }, entry.source));
    try {
      return { ...(await this.map(trace, phases, journal, now)), tracePath: trace.path };
    } finally {
      phases.close();
    }
  }

  /** Runs the phases of the cartography, each traced. */
  private async map(trace: Trace, phases: TracedPhases, journal: Journal, now: () => Date): Promise<Omit<CartographyOutcome, "tracePath">> {
    const { config, environment, repositoryRoot, env } = this.options;
    const sources = runSources(config, environment);
    const access = { repositoryRoot, env, ...(this.options.sqlClient === undefined ? {} : { sqlClient: this.options.sqlClient }) };
    phases.start("survey");
    const surveys = await Promise.all(sources.map(async (source) => [source, await surveySource(source, access)] as const));
    for (const [source, survey] of surveys) {
      trace.harness("survey", survey.ok ? { type: "survey", answers: true, ...(survey.inventory === undefined ? {} : { items: survey.inventory.items.length }) } : { type: "survey", answers: false, error: survey.error }, source.id);
      if (!survey.ok) journal.record("error", `The source ${source.id} does not answer: ${survey.error}`, source.id);
    }
    if (surveys.some(([, survey]) => !survey.ok)) {
      journal.record("error", "No index was written: every declared source must answer before the exploration.");
      phases.end("failed");
      return { journal: journal.entries() };
    }
    phases.end("done");
    phases.start("card");
    const inventories = new Map(surveys.flatMap(([source, survey]) => (survey.ok && survey.inventory !== undefined ? [[source.id, survey.inventory] as const] : [])));
    const results = await mapSources({ ...this.options, now, inventories, trace });
    for (const { outcome } of results) journal.adopt(outcome.journal);
    const cards = new Map(results.flatMap(({ source, outcome }) => (outcome.card === undefined ? [] : [[source.id, outcome.card] as const])));
    phases.end(cardsOutcome(cards.size, results.length, [...cards.values()].every((card) => card.status === "complete")));
    phases.start("consolidation");
    const inventory = new Map([...cards].map(([id, card]) => [id, elementsOf(card)] as const));
    if ([...inventory.values()].every((elements) => elements.length === 0)) {
      journal.record("error", `No index was written: ${cards.size === 0 ? "no source has a card" : "the cards hold no element"}.`);
      return { journal: journal.entries() };
    }
    const submission = new HandedIn(domainIndexRules(inventory, new Set(sources.map((source) => source.id)), (id) => cards.has(id), configSecrets(config, env)), journal);
    const notes = agentNotes(config, repositoryRoot, env, { role: "cartographer", task: `index-${environment}-${now().toISOString()}`, now });
    const events: AgentEvent[] = [];
    const task = {
      instructions: CARTOGRAPHER_INSTRUCTIONS,
      tools: [...notes, submission.tool()],
      request: cartographyRequest(environment, sources, cards),
      events,
      reminder: () => submission.reminder(),
      sent: (text: string) => trace.harness("consolidation", { type: "message", text }),
      received: (event: AgentEvent) => trace.agent("consolidation", event),
    };
    await runAgentTask(this.options.runtime, task, taskLimits(config));
    for (const event of events) if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`);
    const { last, counters } = taskEnd(events);
    if (last.type === "error") journal.record("error", `The consolidation failed: ${last.error.message}`);
    if (last.type === "stopped") journal.record("error", `The consolidation reached its ${last.reason.limit} limit.`);
    const accepted = submission.accepted;
    if (accepted === undefined) {
      journal.record("error", "No index was written: no index was accepted before the session ended.");
      return { journal: journal.entries() };
    }
    phases.end(last.type === "end" ? "done" : "truncated");
    phases.start("index");
    const states = sources.map((source): IndexSource => ({ id: source.id, type: source.type, state: cards.has(source.id) ? "read" : "not_read" }));
    const made = results.flatMap(({ outcome }) => (outcome.card === undefined || outcome.kept ? [] : [outcome.card.run]));
    const index: DomainIndex = {
      formatVersion: 1,
      producedAt: now().toISOString(),
      environment,
      model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
      run: {
        iterations: counters.iterations + sum(made.map((run) => run.iterations)),
        actions: counters.actions + sum(made.map((run) => run.actions)),
        durationMs: Math.round(counters.elapsedMs) + sum(made.map((run) => run.durationMs)),
      },
      status: last.type === "end" && states.every((s) => s.state === "read") && [...cards.values()].every((card) => card.status === "complete") ? "complete" : "truncated",
      sources: states,
      ...accepted,
    };
    const outcome = await this.write(index, journal);
    if (outcome.index !== undefined) phases.end(outcome.index.status === "complete" ? "done" : "truncated");
    return outcome;
  }

  private async write(index: DomainIndex, journal: Journal): Promise<Omit<CartographyOutcome, "tracePath">> {
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

/** How the phase of the cards ended: `failed` without any card, `truncated` when one is missing or truncated. */
function cardsOutcome(cards: number, sources: number, complete: boolean): PhaseOutcome {
  if (cards === 0) return "failed";
  return cards === sources && complete ? "done" : "truncated";
}

/** Every element of a card, placed in a domain or not. */
function elementsOf(card: SourceCard): string[] {
  return [...new Set([...card.domains.flatMap((domain) => domain.items.map((item) => item.name)), ...card.unassigned])];
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
