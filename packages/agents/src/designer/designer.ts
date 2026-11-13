import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import type { AgentEvent, AgentRuntime } from "@open-qa-stack/domain";
import { declaredValues, validateDomainIndex, validateSourceCard, type DomainIndex, type ResolvedConfig, type SourceCard } from "@open-qa-stack/shared";
import { browserTools, knowledgeTools, type BrowserAccess } from "@open-qa-stack/tools";
import { agentNotes } from "../common/agent-notes.ts";
import { runAgentTask, taskEnd, taskLimits } from "../common/agent-task.ts";
import { Journal, type JournalEntry } from "../common/journal.ts";
import { INDEX_FILE_NAME } from "../cartographer/cartographer.ts";
import { CARDS_FOLDER } from "../source-cartographer/source-cartographer.ts";
import { designRequest } from "./designer-prompt.ts";
import { DESIGNS_FOLDER, type DesignedTest, type DesignState } from "./design-state.ts";
import type { TestCheck, TestRunner } from "@open-qa-stack/domain";
import { declaredAddresses, declaredSecrets } from "./spec-rules.ts";
import { MIN_TESTS, TestProposals, type AcceptedTest } from "./test-proposals.ts";
import { TestRepository } from "./test-repository.ts";

/** Prefix of the branches the designer creates. */
export const BRANCH_PREFIX = "oqas/";

/** What a design needs. */
export interface DesignerOptions {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** Absolute path of the test repository, the root of a git repository. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings and credentials the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The runtime that opens the agent's session. */
  readonly runtime: AgentRuntime;
  /** System instructions of the designer, composed from the test charter by the caller. */
  readonly instructions: string;
  /** A check run on each test before it is accepted, such as one against the charter; none by default. */
  readonly check?: TestCheck;
  /** Runs each test against the application before it is kept, such as the `TrialRunner` of the harness. */
  readonly runner: TestRunner;
  /** Name of the branch to create; `oqas/design-<date>` by default. */
  readonly branch?: string;
  /** How the browser starts and waits; a headless Chromium with the default waits otherwise. */
  readonly browser?: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs">;
  /** The clock of the dates; the system clock by default. */
  readonly now?: () => Date;
}

/** What a design produced. */
export interface DesignOutcome {
  /** Whether at least three tests were written. */
  readonly ok: boolean;
  /** The branch created, when tests were written; it is the one checked out. */
  readonly branch?: string;
  /** Where the design state was written, when it was. */
  readonly statePath?: string;
  /** The tests written, in the order they were accepted. */
  readonly tests: readonly DesignedTest[];
  /** What the run checked, refused and wrote. */
  readonly journal: readonly JournalEntry[];
}

/**
 * The designer: from the domain index of the test repository, it writes three or four Playwright tests on
 * a new local branch, with the state of the design.
 *
 * @remarks
 * Before any session, the index must be readable, and the test repository must be the root of a git
 * repository with no tracked file changed, no untracked file outside the folders of the state and the index,
 * and no branch of the name to create; otherwise nothing is written. The agent gets the index and what the
 * cards say of each element, the browser tools of the applications, the tools of the documents, the source
 * code and the logs — never those of a contract or a base, whose substance the index holds — and the notes.
 * It proposes its tests one by one with `propose_test`, under the limits of the configured autonomy. Once
 * the session is over, the accepted tests, in the folder of their application, and the design state are
 * committed on a new branch from the revision checked out, which stays checked out. Nothing contacts a
 * remote. With fewer than three tests, those obtained are still written and the design fails.
 */
export class Designer {
  private readonly options: DesignerOptions;

  /** @param options - What the design needs. */
  public constructor(options: DesignerOptions) {
    this.options = options;
  }

  /**
   * Runs a design.
   *
   * @returns The branch and the tests written, if any, and the journal.
   * @throws Error when a file cannot be written, or git refuses the branch or the commit.
   */
  public async run(): Promise<DesignOutcome> {
    const { config, repositoryRoot, env } = this.options;
    const journal = new Journal();
    const failed = (message: string): DesignOutcome => {
      journal.record("error", message);
      return { ok: false, tests: [], journal: journal.entries() };
    };
    const now = this.options.now ?? (() => new Date());
    const start = now();
    const id = `design-${start.toISOString().replace(/[-:]|\.\d+/g, "")}`;
    const branch = this.options.branch ?? `${BRANCH_PREFIX}${id}`;
    const repository = new TestRepository(repositoryRoot);
    const problems = await repository.problems(branch, [config.repository.stateDir, config.repository.indexDir]);
    for (const problem of problems) journal.record("error", problem);
    if (problems.length > 0) return failed("No branch was created and no file was written.");
    const index = await this.index();
    if (typeof index === "string") return failed(`No test was designed: ${index}`);

    const applications = config.applications.filter((application) => application.environments.some((environment) => environment.name === index.environment));
    const proposals = new TestProposals(
      {
        repositoryRoot,
        appsDir: config.repository.appsDir,
        applications: applications.map((application) => application.id),
        domains: index.domains.map((domain) => domain.id),
        addresses: declaredAddresses(config),
        secrets: declaredSecrets(config, env),
        ...(this.options.check === undefined ? {} : { check: this.options.check }),
        runner: this.options.runner,
      },
      journal,
    );
    const browser = browserTools(applications, { environment: index.environment, env, screenshotsDir: join(repositoryRoot, config.repository.stateDir, "screenshots"), ...this.options.browser });
    const readable = config.knowledge.filter((source) => source.type !== "openapi" && source.type !== "postgresql" && source.attachments.some((a) => a.environment === undefined || a.environment === index.environment));
    const knowledge = knowledgeTools(readable, { repositoryRoot, env, secrets: declaredValues(config, env), taskStart: start });
    const notes = agentNotes(config, repositoryRoot, env, { role: "designer", task: id, now });
    const events: AgentEvent[] = [];
    const request = designRequest(index, applications, await this.cards(index));
    const task = { instructions: this.options.instructions, tools: [...browser.tools, ...knowledge, ...notes, proposals.trialTool(), proposals.tool()], request, events, reminder: () => proposals.reminder() };
    await runAgentTask(this.options.runtime, task, taskLimits(config)).finally(() => browser.close());
    for (const event of events) if (event.type === "tool-error") journal.record("error", `${event.tool}: ${event.message}`);
    const { last, counters } = taskEnd(events);
    if (last.type === "error") journal.record("error", `The session failed: ${last.error.message}`);
    if (last.type === "stopped") journal.record("error", `The task reached its ${last.reason.limit} limit; no test was written for the proposal under way.`);

    const tests = proposals.accepted;
    if (tests.length === 0) return failed(`No test was written: ${obtained(0)}, ${MIN_TESTS} at least are expected.`);
    const state: DesignState = {
      formatVersion: 1,
      producedAt: start.toISOString(),
      environment: index.environment,
      branch,
      base: await repository.head(),
      model: { provider: config.model.provider, baseUrl: config.model.baseUrl, model: config.model.model },
      run: { iterations: counters.iterations, actions: counters.actions, durationMs: Math.round(counters.elapsedMs) },
      tests: tests.map(({ content: _content, ...test }) => test),
    };
    const statePath = posix.join(config.repository.stateDir, DESIGNS_FOLDER, `${id}.json`);
    await this.write(repository, state, statePath, tests, journal);
    if (tests.length < MIN_TESTS) journal.record("error", `The design failed: ${obtained(tests.length)}, ${MIN_TESTS} at least are expected.`);
    return { ok: tests.length >= MIN_TESTS, branch, statePath: join(repositoryRoot, statePath), tests: state.tests, journal: journal.entries() };
  }

  /** Creates the branch, writes the tests and the state, and commits them. */
  private async write(repository: TestRepository, state: DesignState, statePath: string, tests: readonly AcceptedTest[], journal: Journal): Promise<void> {
    const { repositoryRoot } = this.options;
    await repository.createBranch(state.branch);
    const files = [...tests.map((test) => [test.path, test.content.endsWith("\n") ? test.content : `${test.content}\n`] as const), [statePath, `${JSON.stringify(state, null, 2)}\n`] as const];
    for (const [path, content] of files) {
      await mkdir(dirname(join(repositoryRoot, path)), { recursive: true });
      await writeFile(join(repositoryRoot, path), content);
    }
    const message = [`test: add ${tests.length} generated Playwright tests`, "", ...tests.map((test) => `- ${test.path}: ${test.reason}`)].join("\n");
    const committed = new Set(await repository.commit(files.map(([path]) => path), message));
    for (const test of tests) journal.record("info", `The test ${test.path} was written.`);
    journal.record("info", `The design state was written to ${statePath}${committed.has(statePath) ? "" : ", which git ignores: it was not committed"}.`);
    journal.record("info", `The tests were committed on ${state.branch}; the active branch of the test repository is ${await repository.branch()}.`);
  }

  /** The domain index, or why it cannot be read. */
  private async index(): Promise<DomainIndex | string> {
    const path = join(this.options.repositoryRoot, this.options.config.repository.indexDir, INDEX_FILE_NAME);
    const content = await readJson(path);
    if (content === undefined) return `the domain index ${path} cannot be read.`;
    const validation = validateDomainIndex(content);
    return validation.ok ? validation.value : `the domain index ${path} does not match its schema: ${validation.errors.map((error) => error.message).join(" ")}`;
  }

  /** The cards of the sources of the index that have a readable one. */
  private async cards(index: DomainIndex): Promise<Map<string, SourceCard>> {
    const folder = join(this.options.repositoryRoot, this.options.config.repository.indexDir, CARDS_FOLDER);
    const read = await Promise.all(
      index.sources.map(async (source) => {
        const validation = validateSourceCard(await readJson(join(folder, `${source.id}.json`)));
        return validation.ok ? [[source.id, validation.value] as const] : [];
      }),
    );
    return new Map(read.flat());
  }
}

/** How many tests a design obtained, in words. */
function obtained(count: number): string {
  return `${count} ${count === 1 ? "test was" : "tests were"} obtained`;
}

/** The JSON value of a file; `undefined` when it cannot be read or parsed. */
async function readJson(path: string): Promise<unknown> {
  return readFile(path, "utf8").then(
    (text) => JSON.parse(text) as unknown,
    () => undefined,
  ).catch(() => undefined);
}
