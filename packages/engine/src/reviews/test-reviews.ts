import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Session, SessionMessage } from "@open-qa-stack/domain/sessions";
import { LocalMerge } from "./local-merge.ts";
import { countedTests, DESIGNS_FOLDER, readPlanFile, type DesignedTest, type DesignState } from "@open-qa-stack/agents";
import {
  CONFIG_FILE_NAME,
  DEFAULT_REPOSITORY,
  isTerminal,
  ReviewRefusedError,
  reviewRefusalOf,
  reviewStatusAfter,
  type ConfigurationQueries,
  type CorrectedTest,
  type LessonStorePort,
  type ReviewCorrection,
  type ReviewStatus,
  type DecidedTest,
  type ReviewDecision,
  type SessionQueries,
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

/** The sessions of the instance, as the review reads them, and resumes one to correct a test on a host that runs sessions. */
export type ReviewSessions = Pick<SessionQueries, "sessions"> & { resume?(id: string, message: SessionMessage): Promise<Session> };

/**
 * Where a test stands, from what a person decided of it: a test whose correction was asked is in correction while the
 * session that corrects it goes on, and to review again once it ended.
 *
 * @param decision - What the person decided of it, when they did.
 * @param sessions - The sessions of the instance.
 * @returns Where it stands.
 */
function statusOf(decision: TestDecision | undefined, sessions: readonly Session[]): ReviewStatus {
  if (decision?.status !== "in_correction") return decision?.status ?? "in_review";
  const correcting = sessions.find((session) => session.id === decision.session);
  return correcting !== undefined && !isTerminal(correcting.state) ? "in_correction" : "in_review";
}

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
 * stays listed with them; one whose correction was asked is in correction while the session that corrects it goes on,
 * and to review again once it ended, with what was asked. Nothing is kept of the queue itself: it is read at each call.
 */
export class TestReviews {
  readonly #repository: string | undefined;
  readonly #configuration: ConfigurationQueries;
  readonly #decisions: TestDecisionStorePort;
  readonly #sessions: ReviewSessions;
  readonly #now: () => Date;
  readonly #lessons: Pick<LessonStorePort, "add"> | undefined;
  readonly #newId: () => string;

  /**
   * @param repository - Absolute path of the test repository; `undefined` for a host that has none, which lists none.
   * @param configuration - What tells the revision in force of the configuration, which names the state folder.
   * @param decisions - What keeps what a person decided of each test.
   * @param sessions - The sessions of the instance: none may run while a test enters the working branch, and the one that
   * wrote a test is resumed to correct it, by a host that runs sessions.
   * @param now - The clock the decisions are dated by.
   * @param lessons - What keeps the lessons a correction asked is kept as, when the person asks it.
   * @param newId - Gives the identifier of such a lesson.
   */
  constructor(
    repository: string | undefined,
    configuration: ConfigurationQueries,
    decisions: TestDecisionStorePort,
    sessions: ReviewSessions,
    now: () => Date = () => new Date(),
    lessons?: Pick<LessonStorePort, "add">,
    newId: () => string = randomUUID,
  ) {
    this.#lessons = lessons;
    this.#newId = newId;
    this.#repository = repository;
    this.#configuration = configuration;
    this.#decisions = decisions;
    this.#sessions = sessions;
    this.#now = now;
  }

  /** @returns The tests to review and those set aside, the oldest design first, and how many of each. */
  async queue(): Promise<ReviewQueue> {
    const decided = await this.#decided();
    const sessions = await this.#sessions.sessions();
    const tests = (await this.#designed())
      .map((designed) => listed(designed, statusOf(decided.get(designed.id), sessions)))
      .filter((test) => test.status !== "validated");
    return {
      tests,
      counts: { inReview: tests.filter((test) => test.status !== "set_aside").length, setAside: tests.filter((test) => test.status === "set_aside").length },
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
      ...listed(designed, statusOf(decision, await this.#sessions.sessions())),
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

  /**
   * Keeps what a person decides of a test to review. A test validated enters the working branch of the test repository:
   * its file and those its design wrote for it are taken from the branch of its design and committed there, in the
   * checkout of the repository, which is left on that branch; nothing is pushed. A test set aside stays out of it.
   *
   * @param id - The identifier of a test the agents wrote.
   * @param decision - To validate it, or to set it aside, with why.
   * @returns The decision kept, and for a test validated, the branch it entered.
   * @throws UnknownProposalError when no design gave a test of the identifier.
   * @throws ReviewRefusedError when the test was decided already, when a session runs, or when the repository cannot take it now.
   */
  async decide(id: string, decision: ReviewDecision): Promise<DecidedTest> {
    const designed = (await this.#designed()).find((candidate) => candidate.id === id);
    if (designed === undefined) throw new UnknownProposalError(id);
    const sessions = await this.#sessions.sessions();
    const status = statusOf((await this.#decided()).get(id), sessions);
    if (reviewStatusAfter(decision.status === "validated" ? "validate" : "set_aside", status) === undefined)
      throw new ReviewRefusedError(reviewRefusalOf(designed.test.path, status));
    const at = this.#now().toISOString();
    if (decision.status === "set_aside") {
      const kept = { id, at, ...decision };
      await this.#decisions.set(kept);
      return { decision: kept };
    }
    if (sessions.some(({ state }) => state === "running" || state === "queued"))
      throw new ReviewRefusedError("A session runs or waits in the test repository: validate the test once it ended.");
    const reserved = [...(await this.#reserved()), CONFIG_FILE_NAME];
    const { state, test, scenario } = designed;
    const files = [test.path, ...supportOf(await this.#changed(state), reserved)];
    const entered = await new LocalMerge(this.#repository!).take(state, files, reserved, `test: keep ${scenario.title}`);
    const kept = { id, status: "validated" as const, at };
    await this.#decisions.set(kept);
    return { decision: kept, entered };
  }

  /**
   * Puts a test set aside back in review, as it was: the decision made of it is forgotten, and it waits for a new one.
   *
   * @param id - The identifier of a test the agents wrote.
   * @throws UnknownProposalError when no design gave a test of the identifier.
   * @throws ReviewRefusedError when the test is not set aside: in review already, or validated, which its branch keeps.
   */
  async restore(id: string): Promise<void> {
    const designed = (await this.#designed()).find((candidate) => candidate.id === id);
    if (designed === undefined) throw new UnknownProposalError(id);
    const status = statusOf((await this.#decided()).get(id), await this.#sessions.sessions());
    if (reviewStatusAfter("restore", status) === undefined) throw new ReviewRefusedError(reviewRefusalOf(designed.test.path, status));
    await this.#decisions.drop(id);
  }

  /**
   * Asks the session that wrote a test to review to correct it, as the person says: the session is resumed with what
   * they ask, and its agents repair the test in its own file on the branch of its design, keeping to its scenario. The
   * test is in correction while the session goes on, and to review again once it ended.
   *
   * @param id - The identifier of a test the agents wrote.
   * @param correction - What the person asks to change, and whether it is kept as a lesson for the design of the tests of the application of the test.
   * @returns The decision kept, and the session resumed.
   * @throws UnknownProposalError when no design gave a test of the identifier.
   * @throws ReviewRefusedError when the test is not in review, when no session of the instance wrote it, or when that
   * session still goes on.
   */
  async correct(id: string, correction: ReviewCorrection): Promise<CorrectedTest> {
    const designed = (await this.#designed()).find((candidate) => candidate.id === id);
    if (designed === undefined) throw new UnknownProposalError(id);
    const { state, test, scenario } = designed;
    const sessions = await this.#sessions.sessions();
    const status = statusOf((await this.#decided()).get(id), sessions);
    if (reviewStatusAfter("correct", status) === undefined) throw new ReviewRefusedError(reviewRefusalOf(test.path, status));
    // The sessions are listed the latest first: the one that wrote the design last is the one that goes on with its branch.
    const writer = sessions.find((session) => session.result?.branch === state.branch);
    if (writer === undefined)
      throw new ReviewRefusedError(`No session of this instance wrote the test ${test.path}: open one that asks to fix it, in your words.`);
    if (!isTerminal(writer.state))
      throw new ReviewRefusedError(`The session ${writer.id} that wrote the test ${test.path} still goes on: ask for the correction once it ended.`);
    const text = [
      `Fix the test ${test.path}, "${scenario.title}", which a person reviewed and asks to correct.`,
      "Repair it in its own file, keeping to its scenario, and run it again.",
      `What the person asks:\n${correction.instruction}`,
    ].join(" ");
    const session = await this.#sessions.resume!(writer.id, { text });
    const at = this.#now().toISOString();
    const decision = { id, status: "in_correction" as const, at, instruction: correction.instruction, session: writer.id };
    await this.#decisions.set(decision);
    // Kept as a lesson, the instruction is given to the agents that design the tests of the application from then on.
    if (correction.remember === true)
      await this.#lessons?.add({
        id: this.#newId(),
        kind: "correction",
        text: correction.instruction,
        application: scenario.application,
        target: "design",
        active: true,
        at,
        test: id,
      });
    return { decision, session };
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
    const added = await this.#changed(state);
    const support = supportOf(added, reserved);
    const files: ProposedFile[] = [];
    for (const file of [path, ...support]) {
      const content = await this.#git("show", `${state.branch}:${file}`);
      if (content !== undefined) files.push({ path: file, content, added: added.get(file) ?? 0 });
    }
    return files;
  }

  /** The files a design changed on its branch, from the revision it started from, by how many lines it added to each. */
  async #changed(state: DesignState): Promise<Map<string, number>> {
    const counts = (await this.#git("diff", "--numstat", state.base, state.branch)) ?? "";
    return new Map(
      counts
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split("\t"))
        .map(([plus, , file]) => [file!, Number(plus)] as const),
    );
  }

  /** What git writes out in the test repository; `undefined` when it fails. */
  #git(...args: string[]): Promise<string | undefined> {
    return new Promise((resolve) =>
      execFile("git", args, { cwd: this.#repository, maxBuffer: GIT_OUTPUT_LIMIT }, (error, stdout) => resolve(error === null ? stdout : undefined)),
    );
  }
}

/** The files a design changed besides its tests and what the harness keeps: those a test relies on, such as page objects. */
function supportOf(changed: ReadonlyMap<string, number>, reserved: readonly string[]): string[] {
  return [...changed.keys()].filter((file) => !file.endsWith(".spec.ts") && !reserved.some((folder) => file.startsWith(folder)));
}

/** A test of a design as the queue lists it, with what a person decided of it. */
function listed({ id, state, test, scenario }: Designed, status: ReviewStatus): ReviewedTest {
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
    status,
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
