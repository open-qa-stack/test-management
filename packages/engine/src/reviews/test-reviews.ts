import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { countedTests, DESIGNS_FOLDER, readPlanFile, type DesignedTest, type DesignState } from "@open-qa-stack/agents";
import {
  DEFAULT_REPOSITORY,
  type ConfigurationQueries,
  type PlannedScenario,
  type ProposedFile,
  type ReviewedTest,
  type ReviewQueue,
  type ReviewRemark,
  type TestDecision,
  type TestDecisionStorePort,
  type TestProposal,
  UnknownProposalError,
} from "@open-qa-stack/domain";

/** The most git may write out for one file of a test. */
const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;

/** The identifier a test bears, in its tag. */
const TEST_ID = /@oqas-id-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

/** A test of a design, as its state, its plan and its branch tell it. */
interface Designed {
  readonly id: string;
  readonly state: DesignState;
  readonly test: DesignedTest;
  readonly scenario: PlannedScenario;
}

/**
 * The operation that lists the tests the agents wrote for a person to review, and tells what each holds. Whatever shows
 * them — the console through the API — calls it and holds no rule of its own.
 *
 * @remarks
 * A test to review is one a design kept as passing, or failing because of the application, on its branch: its state,
 * in the state folder of the test repository, names it, its plan gives its scenario, and the branch has its file, whose
 * tag gives its identifier. A test a later design wrote again is the one of that design. What a person decided of it
 * is kept by its identifier: a test validated has entered the working branch and leaves the queue; one set aside
 * stays listed with them. Nothing is kept of the queue itself: it is read at each call.
 */
export class TestReviews {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;
  readonly #decisions: TestDecisionStorePort;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which lists none.
   * @param configuration - What tells the revision in force of the configuration, which names the state folder.
   * @param decisions - What keeps what a person decided of each test.
   */
  constructor(repository: string | undefined, configuration: ConfigurationQueries, decisions: TestDecisionStorePort) {
    this.#repository = repository;
    this.#configuration = configuration;
    this.#decisions = decisions;
  }

  /** @returns The tests to review and those set aside, the oldest design first, and how many of each. */
  async queue(): Promise<ReviewQueue> {
    const decided = await this.#decided();
    const tests = (await this.#designed()).map((designed) => listed(designed, decided.get(designed.id))).filter((test) => test.status !== "validated");
    return {
      tests,
      counts: { inReview: tests.filter((test) => test.status === "in_review").length, setAside: tests.filter((test) => test.status === "set_aside").length },
    };
  }

  /**
   * @param id - The identifier of a test the agents wrote.
   * @returns What a person reads to decide of it: its scenario, its runs, the remarks of the agents that reviewed it,
   * and the files its design wrote for it.
   * @throws UnknownProposalError when no design gave a test of the identifier.
   */
  async proposal(id: string): Promise<TestProposal> {
    const designed = (await this.#designed()).find((candidate) => candidate.id === id);
    if (designed === undefined) throw new UnknownProposalError(id);
    const decision = (await this.#decided()).get(id);
    const { state, test, scenario } = designed;
    return {
      ...listed(designed, decision),
      ...(state.brief === undefined ? {} : { brief: state.brief }),
      intent: scenario.intent,
      sources: scenario.sources.map(({ source, item }) => (item === undefined ? { source } : { source, item })),
      steps: scenario.steps.map(({ action, expects }) => ({ action, expects: expects.map(({ result }) => result) })),
      reason: test.classes.at(-1)!.reason,
      remarks: remarksOf(test),
      files: await this.#files(state, test.path, await this.#reserved()),
      ...(decision === undefined ? {} : { decision }),
    };
  }

  /** What a person decided, by test. */
  async #decided(): Promise<Map<string, TestDecision>> {
    return new Map((await this.#decisions.list()).map((decision) => [decision.id, decision]));
  }

  /** The folders the harness writes in the test repository, the state and the knowledge: no file of a test is in them. */
  async #reserved(): Promise<string[]> {
    const repository = (await this.#configuration.inForce())?.document.repository;
    return [repository?.stateDir ?? DEFAULT_REPOSITORY.stateDir, repository?.knowledgeDir ?? DEFAULT_REPOSITORY.knowledgeDir].map((folder) =>
      folder.endsWith("/") ? folder : `${folder}/`,
    );
  }

  /** The tests the designs kept and whose file their branch has, the latest design of each identifier, in the order of the designs. */
  async #designed(): Promise<Designed[]> {
    const revision = await this.#configuration.inForce();
    if (this.#repository === undefined || revision === undefined) return [];
    const folder = join(this.#repository, revision.document.repository?.stateDir ?? DEFAULT_REPOSITORY.stateDir, DESIGNS_FOLDER);
    const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".json")).toSorted((a, b) => a.localeCompare(b));
    const found = new Map<string, Designed>();
    for (const name of names) {
      const state = JSON.parse(await readFile(join(folder, name), "utf8")) as DesignState;
      const plan = readPlanFile(await readFile(join(this.#repository, state.plan), "utf8").catch(() => ""));
      for (const test of countedTests(state.tests ?? [])) {
        const scenario = plan?.scenarios.find((candidate) => candidate.id === test.scenario);
        const content = await this.#git("show", `${state.branch}:${test.path}`);
        const id = content === undefined ? undefined : TEST_ID.exec(content)?.[1];
        if (scenario === undefined || id === undefined) continue;
        found.delete(id);
        found.set(id, { id, state, test, scenario });
      }
    }
    return [...found.values()];
  }

  /** The file of a test, then the files its design wrote besides the tests, such as page objects, with how many lines it added to each. */
  async #files(state: DesignState, path: string, reserved: readonly string[]): Promise<ProposedFile[]> {
    const counts = (await this.#git("diff", "--numstat", state.base, state.branch)) ?? "";
    const added = new Map(
      counts
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split("\t"))
        .map(([plus, , file]) => [file!, Number(plus)] as const),
    );
    const support = [...added.keys()].filter((file) => !file.endsWith(".spec.ts") && !reserved.some((folder) => file.startsWith(folder)));
    const files: ProposedFile[] = [];
    for (const file of [path, ...support]) {
      const content = await this.#git("show", `${state.branch}:${file}`);
      if (content !== undefined) files.push({ path: file, content, added: added.get(file) ?? 0 });
    }
    return files;
  }

  /** What git writes out in the test repository; `undefined` when it fails. */
  #git(...args: string[]): Promise<string | undefined> {
    return new Promise((resolve) =>
      execFile("git", args, { cwd: this.#repository, maxBuffer: GIT_OUTPUT_LIMIT }, (error, stdout) => resolve(error === null ? stdout : undefined)),
    );
  }
}

/** A test of a design as the queue lists it, with what a person decided of it. */
function listed({ id, state, test, scenario }: Designed, decision: TestDecision | undefined): ReviewedTest {
  return {
    id,
    path: test.path,
    title: scenario.title,
    application: scenario.application,
    domain: scenario.domain,
    feature: scenario.feature,
    level: scenario.level,
    kind: scenario.kind,
    branch: state.branch,
    designedAt: state.producedAt,
    verdict: test.verdict,
    runs: test.runs.length,
    reviewed: test.review !== undefined,
    remarkCount: (test.review?.findings.length ?? 0) + (test.quality?.findings.length ?? 0),
    status: decision?.status ?? "in_review",
  };
}

/** The remarks of the agents that reviewed a test: on its coherence first, then on its code. */
function remarksOf({ review, quality }: DesignedTest): ReviewRemark[] {
  const coherence = review === undefined ? [] : review.findings.map(({ where, what }): ReviewRemark => ({ about: "coherence", where, what }));
  const code =
    quality === undefined
      ? []
      : quality.findings.map(({ where, what, rule }): ReviewRemark => ({ about: "code", where, what, ...(rule === undefined ? {} : { rule }) }));
  return [...coherence, ...code];
}
