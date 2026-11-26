import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  readsImages,
  validateKnowledgeBase,
  type AgentEvent,
  type AgentRuntime,
  type KnowledgeBase,
  type HarnessEvent,
  type KnowledgeBaseSource,
  type MappedKnowledge,
  type ModelUsage,
  type PhaseOutcome,
  type ResolvedConfig,
  type StopReason,
  type ToolDefinition,
  type TraceLine,
  modelOrigin,
  type MemoryStorePort,
} from "@open-qa-stack/domain";
import { browserTools, knowledgeTools, scopedToolName, type BrowserAccess, type KnowledgeAccess } from "@open-qa-stack/tools";
import { knowledgeLanguageRule } from "../common/language-rules.ts";
import { agentMemory } from "../common/agent-memory.ts";
import { ScreenTrail } from "../application-explorer/screen-trail.ts";
import { configSecrets } from "../common/config-secrets.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { PersonDelivery } from "../common/person-delivery.ts";
import type { Inbox } from "../common/inbox.ts";
import { NO_USAGE, totalUsage, usageOf } from "../common/model-usage.ts";
import { runTrace } from "../common/run-trace.ts";
import type { Trace } from "../common/trace.ts";
import { TracedPhases } from "../common/traced-phases.ts";
import { CARDS_FOLDER } from "../source-cartographer/source-cartographer.ts";
import { mapSources } from "../source-cartographer/sources-cartography.ts";
import { SourceFolder } from "../source-workflow/source-folder.ts";
import { cardFingerprint } from "./card-fingerprint.ts";
import { CARTOGRAPHER_INSTRUCTIONS, CARTOGRAPHER_VALUES, cartographyRequest } from "./cartographer-prompt.ts";
import { DomainConsolidation } from "./domain-consolidation.ts";
import { knowledgeBaseStaleness } from "./knowledge-base-staleness.ts";
import { runSources, type RunSource } from "./run-sources.ts";
import { sourceDomainTool } from "./source-domain-tool.ts";
import { surveySource, type SurveyResult } from "./source-survey.ts";

/** Name of the knowledge base file, in the knowledge base folder of the test repository. */
export const KNOWLEDGE_BASE_FILE_NAME = "knowledge-base.json";

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
  /** Where the memories of the agents are kept, which they recall and add to. */
  readonly memory: MemoryStorePort;
  /** Makes the SQL client of a database; PostgreSQL by default. */
  readonly sqlClient?: KnowledgeAccess["sqlClient"];
  /** How the browser starts and waits; a headless Chromium with the default waits otherwise. */
  readonly browser?: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs" | "settleTimeoutMs">;
  /** Most sources mapped at once; one by default. */
  readonly concurrency?: number;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
  /** Receives each line of the trace as it is written, to follow the cartography while it runs. */
  readonly observe?: (line: TraceLine) => void;
  /** The inbox of the run: the session that consolidates is given the messages a person sends while it is open, and recalled those delivered earlier in the run; those that map a source, several at once, never are. No session hears anyone without it. */
  readonly inbox?: Inbox;
}

/** What a cartography produced. */
export interface CartographyOutcome {
  /** Where the knowledge base was written, when it was. */
  readonly knowledgeBasePath?: string;
  /** The knowledge base written, when it was. */
  readonly knowledgeBase?: KnowledgeBase;
  /** What the run checked, refused and wrote, the cartography of each source first. */
  readonly journal: readonly JournalEntry[];
  /** Where the trace of the cartography is written. */
  readonly tracePath: string;
  /** The first limit that stopped one of its tasks, when no knowledge base was written. */
  readonly stoppedBy?: StopReason["limit"];
}

/**
 * The cartographer: it writes a knowledge base of the application's functional domains in the test repository,
 * by consolidating the cards of the sources the configuration declares.
 *
 * @remarks
 * Before any exploration, every source must answer; otherwise no session starts and no knowledge base is written.
 * The inventory a knowledge source gave then is the one its card is made of: no knowledge source is read twice.
 * Each source without an up-to-date card is then mapped on its own, in its own task, under the limits of
 * the configured autonomy. The knowledge base records the fingerprint of each card it is made of: when the knowledge base
 * already written is complete, of this environment, of the same sources and of the cards they have now, it is
 * kept, without the model. Otherwise a last task consolidates the cards, with the notes
 * the agents kept but none of the tools of the sources, each element followed by the domains of other cards
 * that share a word with it, and hands its knowledge base in with `submit_knowledge_base`, which must place every element of every
 * card in functional domains; the elements it leaves unassigned are asked once more. A source without a card is `not_read`. The knowledge base is written only once a
 * submission was accepted and the whole knowledge base passes its schema; it is `truncated` when a limit stopped the
 * consolidation, a card is truncated or a source was not read. A limit reached while the elements left
 * unassigned are asked once more only ends that second submission: the first stays as it was accepted, and
 * the knowledge base is not truncated for it. When no knowledge base is written, the outcome names the first limit that
 * stopped a task, if one did: a cartography run again keeps the complete cards. Nothing is committed nor pushed.
 *
 * The run is traced in `<stateDir>/traces/`, line by line, and each line is handed to `observe` as it is
 * written: the phases `survey`, `card`, `consolidation` and `knowledge-base`, each from its `started` line to its
 * `finished` line even when the run throws, what the harness did in each, what each phase and the card of
 * each source asked of the model, and every message, reasoning, text and tool call of the agents.
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
   * @returns The knowledge base written, if any, and the journal.
   * @throws Error when a card or the knowledge base cannot be written to the disk.
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
    const surveys = await Promise.all(
      sources.map(async (source) => {
        const survey = await surveySource(source, access);
        trace.harness("survey", surveyEvent(survey), source.id);
        return [source, survey] as const;
      }),
    );
    for (const [source, survey] of surveys) if (!survey.ok) journal.record("error", `The source ${source.id} does not answer: ${survey.error}`, source.id);
    if (surveys.some(([, survey]) => !survey.ok)) {
      journal.record("error", "No knowledge base was written: every declared source must answer before the exploration.");
      endPhase(trace, phases, "failed");
      return { journal: journal.entries() };
    }
    endPhase(trace, phases, "done");
    phases.start("card");
    const inventories = new Map(
      surveys.flatMap(([source, survey]) => (survey.ok && survey.inventory !== undefined ? [[source.id, survey.inventory] as const] : [])),
    );
    const results = await mapSources({ ...this.options, now, inventories, trace });
    for (const { outcome } of results) journal.adopt(outcome.journal);
    const limits = results.flatMap(({ outcome }) => outcome.stoppedBy ?? []);
    const cards = new Map(results.flatMap(({ source, outcome }) => (outcome.card === undefined ? [] : [[source.id, outcome.card] as const])));
    endPhase(
      trace,
      phases,
      cardsOutcome(
        cards.size,
        results.length,
        [...cards.values()].every((card) => card.status === "complete"),
      ),
      totalUsage(results.map(({ outcome }) => outcome.usage)),
    );
    const knowledgeBasePath = this.knowledgeBasePath();
    const previous = await readKnowledgeBase(knowledgeBasePath);
    const stale = knowledgeBaseStaleness(previous, environment, sources, cards);
    if (previous !== undefined && stale === undefined) {
      phases.start("knowledge-base");
      journal.record(
        "info",
        `The knowledge base ${knowledgeBasePath} is complete and made of the cards every source has now, by their fingerprints; it was kept.`,
      );
      endPhase(trace, phases, "kept");
      return { knowledgeBasePath, knowledgeBase: previous, journal: journal.entries() };
    }
    phases.start("consolidation");
    journal.record("info", `The knowledge base is made: ${stale}.`);
    if ([...cards.values()].every((card) => card.domains.length === 0)) {
      journal.record("error", `No knowledge base was written: ${cards.size === 0 ? "no source has a card" : "the sources were mapped into no domain"}.`);
      endPhase(trace, phases, "failed");
      return { journal: journal.entries(), ...firstLimit(limits) };
    }
    const secrets = configSecrets(config, env);
    const submission = new DomainConsolidation(cards, secrets, journal);
    // The orchestrator reads what the agent of each source wrote of a domain, in the folder the source was mapped to.
    const written = (source: string, domain: string) =>
      new SourceFolder(join(repositoryRoot, config.repository.knowledgeDir, CARDS_FOLDER, source), secrets).readDomain(domain);
    const notes = agentMemory(config, this.options.memory, env, { role: "cartographer", task: `knowledgeBase-${environment}-${now().toISOString()}`, now });
    const browser = this.browser(sources);
    const events: AgentEvent[] = [];
    const { inbox } = this.options;
    const task = {
      agent: "cartography-orchestrator" as const,
      instructions: `${CARTOGRAPHER_INSTRUCTIONS}\n\n${knowledgeLanguageRule(config.language)}`,
      values: CARTOGRAPHER_VALUES,
      tools: [sourceDomainTool(cards, written), ...knowledgeTools(declared(sources), access), ...browser.tools, ...notes, submission.tool()],
      request: cartographyRequest(environment, sources, cards),
      events,
      reminder: () => submission.reminder(),
      sent: (text: string) => trace.harness("consolidation", { type: "message", text }),
      received: (event: AgentEvent) => {
        trace.agent("consolidation", event);
        if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`);
      },
      ...(inbox === undefined
        ? {}
        : { person: new PersonDelivery(inbox, ({ number, text }) => trace.harness("consolidation", { type: "person", message: number, text })) }),
    };
    await runAgentTask(this.options.runtime, task, taskLimits(config)).finally(() => browser.close());
    const { last, counters } = taskEnd(events);
    const usage = usageOf(counters);
    if (last.type === "error") journal.record("error", `The consolidation failed: ${last.error.message}`);
    if (last.type === "stopped") {
      journal.record("error", `The consolidation reached its ${last.reason.limit} limit.`);
      limits.push(last.reason.limit);
    }
    const accepted = submission.accepted;
    const settled = last.type === "end";
    if (accepted === undefined) {
      journal.record("error", "No knowledge base was written: no knowledge base was accepted before the session ended.");
      endPhase(trace, phases, "failed", usage);
      return { journal: journal.entries(), ...firstLimit(limits) };
    }
    endPhase(trace, phases, settled ? "done" : "truncated", usage);
    phases.start("knowledge-base");
    const states = sources.map((source): KnowledgeBaseSource => {
      const card = cards.get(source.id);
      return card === undefined
        ? { id: source.id, type: source.type, state: "not_read" }
        : { id: source.id, type: source.type, state: "read", cardFingerprint: cardFingerprint(card) };
    });
    const made = results.flatMap(({ outcome }) => (outcome.card === undefined || outcome.kept ? [] : [outcome.card.run]));
    const knowledgeBase: KnowledgeBase = {
      formatVersion: 1,
      producedAt: now().toISOString(),
      environment,
      model: modelOrigin(config.model),
      run: {
        iterations: counters.iterations + sum(made.map((run) => run.iterations)),
        actions: counters.actions + sum(made.map((run) => run.actions)),
        durationMs: Math.round(counters.elapsedMs) + sum(made.map((run) => run.durationMs)),
      },
      status: settled && states.every((s) => s.state === "read") && [...cards.values()].every((card) => card.status === "complete") ? "complete" : "truncated",
      sources: states,
      ...accepted,
    };
    const outcome = await this.write(knowledgeBasePath, knowledgeBase, journal);
    endPhase(trace, phases, outcome.knowledgeBase === undefined ? "failed" : outcome.knowledgeBase.status === "complete" ? "done" : "truncated");
    return outcome;
  }

  /** The browser of the applications of the run that have a user interface, guarded as an exploration is: it removes no data, and changes none where the environment is explored read-only. */
  private browser(sources: readonly RunSource[]): { readonly tools: ToolDefinition[]; close(): Promise<void> } {
    const { config, environment, repositoryRoot, env } = this.options;
    const explored = config.applications.filter((application) => sources.some((source) => source.type === "web" && source.id === application.id));
    const browser = browserTools(explored, {
      env,
      environment,
      screenshotsDir: join(repositoryRoot, config.repository.stateDir, "screenshots"),
      vision: readsImages(config.model),
      secrets: configSecrets(config, env),
      ...this.options.browser,
    });
    const tools = explored.flatMap((application) => {
      const { uiUrl, exploration } = application.environments.find((candidate) => candidate.name === environment)!;
      const own = browser.tools.filter((tool) => tool.name.startsWith(scopedToolName(application.id, "")));
      return new ScreenTrail(application.id, uiUrl!, exploration ?? "read-only").watched(own);
    });
    return { tools, close: () => browser.close() };
  }

  /** Where the knowledge base is written, in the test repository. */
  private knowledgeBasePath(): string {
    return join(this.options.repositoryRoot, this.options.config.repository.knowledgeDir, KNOWLEDGE_BASE_FILE_NAME);
  }

  private async write(knowledgeBasePath: string, knowledgeBase: KnowledgeBase, journal: Journal): Promise<Omit<CartographyOutcome, "tracePath">> {
    const validation = validateKnowledgeBase(knowledgeBase);
    if (!validation.ok) {
      for (const error of validation.errors) journal.record("error", `The knowledge base does not match its schema: ${error.message}`);
      journal.record("error", "No knowledge base was written.");
      return { journal: journal.entries() };
    }
    await mkdir(dirname(knowledgeBasePath), { recursive: true });
    await writeFile(knowledgeBasePath, `${JSON.stringify(knowledgeBase, null, 2)}\n`);
    journal.record("info", `The knowledge base was written to ${knowledgeBasePath}, ${knowledgeBase.status}.`);
    return { knowledgeBasePath, knowledgeBase, journal: journal.entries() };
  }
}

/** The first of the limits that stopped the tasks of a cartography, as its outcome gives it. */
function firstLimit(limits: readonly StopReason["limit"][]): Pick<CartographyOutcome, "stoppedBy"> {
  return limits.length === 0 ? {} : { stoppedBy: limits[0]! };
}

/** The knowledge base at `path`, when it is readable and passes its schema. */
async function readKnowledgeBase(path: string): Promise<KnowledgeBase | undefined> {
  const content: unknown = await readFile(path, "utf8")
    .then(
      (text) => JSON.parse(text) as unknown,
      () => undefined,
    )
    .catch(() => undefined);
  const validation = validateKnowledgeBase(content);
  return validation.ok ? validation.value : undefined;
}

/** Ends the phase open, after the line of what it asked of the model. */
function endPhase(trace: Trace, phases: TracedPhases, outcome: PhaseOutcome, usage: ModelUsage = NO_USAGE): void {
  trace.harness(phases.current, { type: "usage", ...usage });
  phases.end(outcome);
}

/** What a source answered at the check, for its trace line. */
function surveyEvent(survey: SurveyResult): HarnessEvent {
  if (!survey.ok) return { type: "survey", answers: false, error: survey.error };
  return { type: "survey", answers: true, ...(survey.inventory === undefined ? {} : { items: survey.inventory.items.length }) };
}

/** How the phase of the cards ended: `failed` without any card, `truncated` when one is missing or truncated. */
function cardsOutcome(cards: number, sources: number, complete: boolean): PhaseOutcome {
  if (cards === 0) return "failed";
  return cards === sources && complete ? "done" : "truncated";
}

/** The knowledge sources of the run, whose tools let the orchestrator check in a source what its map leaves in doubt. */
function declared(sources: readonly RunSource[]): MappedKnowledge[] {
  return sources.flatMap((source) => (source.type === "web" ? [] : [source.knowledge]));
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
