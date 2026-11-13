import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentEvent, AgentRuntime } from "@open-qa-stack/domain";
import { validateSourceCard, type ResolvedConfig, type SourceCard, type SourceCardSubmission } from "@open-qa-stack/shared";
import type { BrowserAccess, KnowledgeAccess } from "@open-qa-stack/tools";
import { agentNotes } from "../common/agent-notes.ts";
import { configSecrets } from "../common/config-secrets.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { HandedIn } from "../common/handed-in.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { cardRules } from "./card-rules.ts";
import { interfaceSubject, knowledgeSubject, type CardSource, type CardSubject } from "./card-subject.ts";
import { SOURCE_CARTOGRAPHER_INSTRUCTIONS } from "./source-cartographer-prompt.ts";

/** Folder of the cards, in the index folder of the test repository. */
export const CARDS_FOLDER = "sources";

/** What the cartography of one source needs. */
export interface SourceCartographerOptions {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** The source to map: a knowledge source, or the user interface of an application. */
  readonly source: CardSource;
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
 * The cartographer of one source: it writes the card of the source, its elements grouped by functional
 * domain, in the test repository.
 *
 * @remarks
 * For a knowledge source, the harness reads the inventory without the model — its elements, their
 * structural facts and its fingerprint. For a user interface, the elements are the screens the agent
 * visits, read from what the browser tools answer, and the fingerprint is that of its address, so that its
 * card is made again on demand only. A complete card whose fingerprint is the source's is kept as it is,
 * unless `force` is set. The agent gets the tools of this source only — the catalog
 * of a base, never its rows — and hands its card in with `submit_card`, which must place every element and
 * invent none. The facts the harness read are joined to the card before it is written. Nothing is
 * committed nor pushed.
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
    const events: AgentEvent[] = [];
    let subject: CardSubject;
    try {
      subject = await this.subject(events);
    } catch (failure) {
      journal.record("error", `The source ${source.id} does not answer: ${failure instanceof Error ? failure.message : String(failure)}`, source.id);
      return { kept: false, journal: journal.entries() };
    }
    const cardPath = join(repositoryRoot, config.repository.indexDir, CARDS_FOLDER, `${source.id}.json`);
    const existing = this.options.force === true ? undefined : await upToDate(cardPath, subject.fingerprint);
    if (existing !== undefined) {
      journal.record("info", `The card of ${source.id} is up to date; it was kept.`, source.id);
      return { cardPath, card: existing, kept: true, journal: journal.entries() };
    }
    const now = this.options.now ?? (() => new Date());
    if (source.type !== "web" && subject.inventory().items.length === 0) {
      journal.record("info", `The source ${source.id} has no element; its card is empty.`, source.id);
      return this.write(cardPath, this.card(subject, { iterations: 0, actions: 0, durationMs: 0 }, "complete", { domains: [], unassigned: [] }, now), journal);
    }
    const submission = new HandedIn(cardRules(source.id, () => subject.inventory(), configSecrets(config, env)), journal);
    const notes = agentNotes(config, repositoryRoot, env, { role: "cartographer", task: `card-${source.id}-${now().toISOString()}`, now });
    const task = { instructions: SOURCE_CARTOGRAPHER_INSTRUCTIONS, tools: [...subject.tools, ...notes, submission.tool()], request: subject.request, events, reminder: () => submission.reminder() };
    await runAgentTask(this.options.runtime, task, taskLimits(config)).finally(() => subject.close());
    for (const event of events) if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`, source.id);
    const { last, counters } = taskEnd(events);
    if (last.type === "error") journal.record("error", `The session failed: ${last.error.message}`, source.id);
    if (last.type === "stopped") journal.record("error", `The task reached its ${last.reason.limit} limit.`, source.id);
    const accepted = submission.accepted;
    if (accepted === undefined) {
      journal.record("error", "No card was written: no card was accepted before the session ended.", source.id);
      return { kept: false, journal: journal.entries() };
    }
    const run = { iterations: counters.iterations, actions: counters.actions, durationMs: Math.round(counters.elapsedMs) };
    return this.write(cardPath, this.card(subject, run, last.type === "end" ? "complete" : "truncated", accepted, now), journal);
  }

  /** The card of a submission, with the facts the harness read joined to each element. */
  private card(subject: CardSubject, run: SourceCard["run"], status: SourceCard["status"], accepted: SourceCardSubmission, now: () => Date): SourceCard {
    const { config, source } = this.options;
    const inventory = subject.inventory();
    return {
      formatVersion: 1,
      source: { id: source.id, type: source.type },
      fingerprint: subject.fingerprint,
      producedAt: now().toISOString(),
      model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
      run,
      status,
      domains: accepted.domains.map((domain) => ({ ...domain, items: domain.items.map((item) => ({ ...item, facts: { ...inventory.facts.get(item.name) } })) })),
      unassigned: accepted.unassigned,
    };
  }

  /** Writes a card that passes its schema. */
  private async write(cardPath: string, card: SourceCard, journal: Journal): Promise<SourceCartographyOutcome> {
    const { source } = this.options;
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

  /** What the cartography works on, by kind of source. */
  private subject(events: readonly AgentEvent[]): Promise<CardSubject> {
    const { config, source, repositoryRoot, env } = this.options;
    if (source.type === "web") {
      return interfaceSubject(config, source, events, { env, screenshotsDir: join(repositoryRoot, config.repository.stateDir, "screenshots"), ...this.options.browser });
    }
    return knowledgeSubject(source, { repositoryRoot, env, ...(this.options.sqlClient === undefined ? {} : { sqlClient: this.options.sqlClient }) });
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
