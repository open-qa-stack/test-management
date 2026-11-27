import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { planFileText, type DesignedTest } from "@open-qa-stack/agents";
import { ReviewRefusedError, UnknownProposalError, type OqasConfig, type PlannedScenario } from "@open-qa-stack/domain";
import { TestReviews } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryTestDecisionStore } from "./support/memory-test-decision-store.ts";

/** The sessions of an instance where none runs. */
const IDLE = { sessions: () => Promise.resolve([]) };

const DOCUMENT = {
  formatVersion: 1,
  applications: [],
  knowledge: [],
  model: { mode: "local", baseUrl: "http://127.0.0.1:9/v1", model: "m" },
} as unknown as OqasConfig;

/** The identifiers the tests of the designs bear. */
const LIST = "11111111-1111-4111-8111-111111111111";
const OPEN = "22222222-2222-4222-8222-222222222222";
const KEPT = "55555555-5555-4555-8555-555555555555";
const FOLDER = "apps/shop/tests/orders/listing";

const git = (root: string, ...args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });

/** A scenario of a plan, of the orders of the shop. */
const scenario = (id: string, title: string): PlannedScenario => ({
  id,
  title,
  intent: `Verify that ${title.toLowerCase()}.`,
  kind: "functional",
  level: "functional",
  case: "nominal",
  effect: "read",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [{ source: "order-specs", item: "Orders" }, { source: "shop" }],
  data: [],
  steps: [{ action: "Open the orders", code: [], expects: [{ result: "The orders show", shows: ["Orders"], absent: [], elements: [] }] }],
});

/** A test a design kept, classed as given. */
const designed = (id: string, kept: string, extra: Partial<DesignedTest> = {}): DesignedTest => ({
  path: `${FOLDER}/${id}.spec.ts`,
  scenario: id,
  verdict: kept === "passed" ? "passed" : "failed",
  classes: [
    {
      at: "2026-11-27T09:00:00.000Z",
      class: kept as DesignedTest["classes"][number]["class"],
      origin: { by: "harness", check: "run_test" },
      reason: `Classed ${kept}.`,
    },
  ],
  runs: [{ verdict: "failed" }, { verdict: "passed" }],
  ...extra,
});

/** Writes a file of the test repository, its folders first. */
function written(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/**
 * A test repository with one design on its branch: a test of the orders that passed, one that opens an order and was
 * reviewed, a page object they rely on, and a test kept unfinished; the state and the plan in the state folder.
 */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-reviews-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.email", "maintainer@example.com");
  git(root, "config", "user.name", "Maintainer");
  written(root, "package.json", "{}\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "chore: start");
  const base = git(root, "rev-parse", "HEAD").trim();
  git(root, "switch", "-q", "-c", "oqas/design-20261127T090000Z");
  written(root, `${FOLDER}/list-orders.spec.ts`, `test("List the orders", { tag: ["@oqas-id-${LIST}"] }, async () => {});\n`);
  written(root, `${FOLDER}/open-order.spec.ts`, `test("Open an order", { tag: ["@oqas-id-${OPEN}"] }, async () => {});\n`);
  written(root, `${FOLDER}/half-done.spec.ts`, `test("Half done", { tag: ["@oqas-id-33333333-3333-4333-8333-333333333333"] }, async () => {});\n`);
  written(root, "apps/shop/pages/orders-page.ts", "export class OrdersPage {}\n// Its rows.\n");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "test: add 3 generated Playwright tests");
  git(root, "switch", "-q", "main");
  const plan = ".oqas/designs/design-20261127T090000Z.plan.md";
  const scenarios = [scenario("list-orders", "The orders are listed"), scenario("open-order", "An order opens"), scenario("half-done", "Half done")];
  written(root, plan, planFileText({ formatVersion: 2, design: "design-20261127T090000Z", environment: "local", scenarios }));
  const tests = [
    designed("list-orders", "passed"),
    designed("open-order", "failing-application", {
      review: { at: "2026-11-27T09:01:00.000Z", findings: [{ where: "step 1", what: "It does not check the total." }] },
      quality: {
        at: "2026-11-27T09:02:00.000Z",
        findings: [
          { where: "line 3", what: "Use a role.", rule: "PW-LOC-01", concerns: "test" },
          { where: "step 2", what: "Name the step after what it does.", concerns: "test" },
        ],
      },
    }),
    designed("half-done", "unfinished"),
  ];
  const state = {
    formatVersion: 4,
    producedAt: "2026-11-27T09:00:00.000Z",
    environment: "local",
    brief: "The orders.",
    plan,
    branch: "oqas/design-20261127T090000Z",
    base,
    tests,
  };
  written(root, ".oqas/designs/design-20261127T090000Z.json", JSON.stringify(state));
  return root;
}

/** The store of a configuration in force. */
async function configured(): Promise<MemoryConfigurationStore> {
  const configuration = new MemoryConfigurationStore();
  await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
  return configuration;
}

describe("the review of the tests the agents wrote", () => {
  it("lists the tests a design kept as passing or failing because of the application, whose file its branch has, with what was decided of each", async () => {
    const decisions = new MemoryTestDecisionStore();
    const reviews = new TestReviews(repository(), await configured(), decisions, IDLE);
    const queue = await reviews.queue();
    assert.deepEqual(queue.counts, { inReview: 2, setAside: 0 });
    assert.deepEqual(
      queue.tests.map(({ id, title, status, verdict, runs, reviewed, remarkCount }) => [id, title, status, verdict, runs, reviewed, remarkCount]),
      [
        [LIST, "The orders are listed", "in_review", "passed", 2, false, 0],
        [OPEN, "An order opens", "in_review", "failed", 2, true, 3],
      ],
    );
    assert.deepEqual(
      [queue.tests[0]!.path, queue.tests[0]!.application, queue.tests[0]!.domain, queue.tests[0]!.feature, queue.tests[0]!.branch, queue.tests[0]!.designedAt],
      [`${FOLDER}/list-orders.spec.ts`, "shop", "orders", "listing", "oqas/design-20261127T090000Z", "2026-11-27T09:00:00.000Z"],
    );
    // A test set aside stays listed with its status; one validated entered the working branch and leaves the queue.
    await decisions.set({ id: LIST, status: "set_aside", at: "2026-11-27T10:00:00.000Z", reason: "covered", coveredBy: `${FOLDER}/other.spec.ts` });
    await decisions.set({ id: OPEN, status: "validated", at: "2026-11-27T10:00:00.000Z" });
    const decided = await reviews.queue();
    assert.deepEqual([decided.counts, decided.tests.map(({ id, status }) => [id, status])], [{ inReview: 0, setAside: 1 }, [[LIST, "set_aside"]]]);
  });

  it("tells what a person reads to decide of a test: its brief, its intent, its steps, the remarks of its reviewers and the files its design wrote", async () => {
    const reviews = new TestReviews(repository(), await configured(), new MemoryTestDecisionStore(), IDLE);
    const proposal = (await reviews.proposal(OPEN))!;
    assert.deepEqual(
      [proposal.brief, proposal.intent, proposal.sources, proposal.steps, proposal.reason, proposal.decision],
      [
        "The orders.",
        "Verify that an order opens.",
        [{ source: "order-specs", item: "Orders" }, { source: "shop" }],
        [{ action: "Open the orders", expects: ["The orders show"] }],
        "Classed failing-application.",
        undefined,
      ],
    );
    assert.deepEqual(proposal.remarks, [
      { about: "coherence", where: "step 1", what: "It does not check the total." },
      { about: "code", where: "line 3", what: "Use a role.", rule: "PW-LOC-01" },
      { about: "code", where: "step 2", what: "Name the step after what it does." },
    ]);
    // Its own file first, then what its design wrote besides the tests; nothing of the state folder.
    assert.deepEqual(
      proposal.files.map(({ path, added }) => [path, added]),
      [
        [`${FOLDER}/open-order.spec.ts`, 1],
        ["apps/shop/pages/orders-page.ts", 2],
      ],
    );
    assert.match(proposal.files[0]!.content, new RegExp(`@oqas-id-${OPEN}`));
    await assert.rejects(reviews.proposal("44444444-4444-4444-8444-444444444444"), UnknownProposalError);
  });

  it("gives the decision made of a test, and lists none without a repository, a configuration in force or a design", async () => {
    const decisions = new MemoryTestDecisionStore();
    const root = repository();
    const reviews = new TestReviews(root, await configured(), decisions, IDLE);
    await decisions.set({ id: LIST, status: "set_aside", at: "2026-11-27T10:00:00.000Z", reason: "out_of_scope" });
    assert.deepEqual((await reviews.proposal(LIST))!.decision, { id: LIST, status: "set_aside", at: "2026-11-27T10:00:00.000Z", reason: "out_of_scope" });
    assert.deepEqual((await new TestReviews(undefined, await configured(), decisions, IDLE).queue()).tests, []);
    assert.deepEqual((await new TestReviews(root, new MemoryConfigurationStore(), decisions, IDLE).queue()).tests, []);
    assert.deepEqual((await new TestReviews(mkdtempSync(join(tmpdir(), "oqas-reviews-")), await configured(), decisions, IDLE).queue()).tests, []);
  });

  it("keeps the latest design of a test, leaves out what cannot be read, and follows the folders the configuration names", async () => {
    const root = mkdtempSync(join(tmpdir(), "oqas-reviews-"));
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "maintainer@example.com");
    git(root, "config", "user.name", "Maintainer");
    written(root, "package.json", "{}\n");
    written(root, "apps/shop/pages/old-page.ts", "export class OldPage {}\n");
    written(root, `${FOLDER}/kept.spec.ts`, `test("Kept", { tag: ["@oqas-id-${KEPT}"] }, async () => {});\n`);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "chore: start");
    const base = git(root, "rev-parse", "HEAD").trim();
    /** A branch from the start that writes the files given, its own name the design's. */
    const branch = (name: string, files: Readonly<Record<string, string>>): void => {
      git(root, "switch", "-q", "-c", name, base);
      for (const [path, text] of Object.entries(files)) written(root, path, text);
      // The design removed a page object the tests no longer need.
      git(root, "rm", "-q", "apps/shop/pages/old-page.ts");
      git(root, "add", "-A");
      git(root, "commit", "-q", "-m", `test: ${name}`);
      git(root, "switch", "-q", "main");
    };
    const tagged = `test("List the orders", { tag: ["@oqas-id-${LIST}"] }, async () => {});\n`;
    branch("oqas/design-a", { [`${FOLDER}/list-orders.spec.ts`]: tagged });
    // The later design writes the test again, with what the harness keeps of the knowledge and of the state beside it.
    branch("oqas/design-b", {
      [`${FOLDER}/list-orders.spec.ts`]: `${tagged}// again\n`,
      "kb/cards/shop.json": "{}\n",
      "state/notes.md": "x\n",
      [`${FOLDER}/untagged.spec.ts`]: 'test("Untagged", async () => {});\n',
    });
    const plan = (name: string) => {
      const path = `state/designs/${name}.plan.md`;
      written(
        root,
        path,
        planFileText({
          formatVersion: 2,
          design: name,
          environment: "local",
          scenarios: [scenario("list-orders", "The orders are listed"), scenario("untagged", "Untagged"), scenario("kept", "Kept")],
        }),
      );
      return path;
    };
    const state = (name: string, at: string, fields: object) =>
      written(root, `state/designs/${name}.json`, JSON.stringify({ formatVersion: 4, producedAt: at, environment: "local", base, ...fields }));
    state("design-a", "2026-11-27T08:00:00.000Z", { plan: plan("design-a"), branch: "oqas/design-a", tests: [designed("list-orders", "passed")] });
    state("design-b", "2026-11-27T09:00:00.000Z", {
      plan: plan("design-b"),
      branch: "oqas/design-b",
      tests: [designed("list-orders", "passed"), designed("untagged", "passed")],
    });
    // A design whose branch is gone, one whose plan cannot be read, one of a scenario its plan does not hold, and one that kept no test.
    state("design-c", "2026-11-27T10:00:00.000Z", { plan: plan("design-c"), branch: "oqas/gone", tests: [designed("list-orders", "passed")] });
    state("design-d", "2026-11-27T11:00:00.000Z", { plan: "state/designs/none.plan.md", branch: "oqas/design-b", tests: [designed("list-orders", "passed")] });
    state("design-e", "2026-11-27T12:00:00.000Z", { plan: plan("design-e"), branch: "oqas/design-b", tests: [designed("elsewhere", "passed")] });
    state("design-f", "2026-11-27T13:00:00.000Z", { plan: plan("design-f"), branch: "oqas/design-b" });
    // A design that kept a test as the start had it, from a revision the repository no longer knows.
    written(
      root,
      "state/designs/design-g.json",
      JSON.stringify({
        formatVersion: 4,
        producedAt: "2026-11-27T14:00:00.000Z",
        environment: "local",
        base: "0123456789abcdef0123456789abcdef01234567",
        plan: plan("design-g"),
        branch: "main",
        tests: [designed("kept", "passed")],
      }),
    );
    const configuration = new MemoryConfigurationStore();
    await configuration.record(
      { origin: "file", fileDigest: "a1", document: { ...DOCUMENT, repository: { stateDir: "state/", knowledgeDir: "kb" } } as OqasConfig },
      0,
    );
    const reviews = new TestReviews(root, configuration, new MemoryTestDecisionStore(), IDLE);
    const queue = await reviews.queue();
    assert.deepEqual(
      queue.tests.map(({ id, branch, designedAt }) => [id, branch, designedAt]),
      [
        [LIST, "oqas/design-b", "2026-11-27T09:00:00.000Z"],
        [KEPT, "main", "2026-11-27T14:00:00.000Z"],
      ],
    );
    // Nothing of the folders of the harness is a file of the test.
    assert.deepEqual(
      (await reviews.proposal(LIST)).files.map(({ path }) => path),
      [`${FOLDER}/list-orders.spec.ts`],
    );
    assert.deepEqual(
      (await reviews.proposal(KEPT)).files.map(({ path, added }) => [path, added]),
      [[`${FOLDER}/kept.spec.ts`, 0]],
    );
    // The page object the design removed is removed from the working branch with the test.
    await reviews.decide(LIST, { status: "validated" });
    assert.deepEqual(
      git(root, "show", "--name-status", "--format=", "HEAD").trim().split("\n").toSorted(),
      ["D\tapps/shop/pages/old-page.ts", `A\t${FOLDER}/list-orders.spec.ts`].toSorted(),
    );
  });
});

describe("the decisions of the review", () => {
  const AT = new Date("2026-11-27T10:00:00.000Z");

  it("set a test aside with why, keep it listed, and refuse to decide of it again or of a test no design gave", async () => {
    const decisions = new MemoryTestDecisionStore();
    const reviews = new TestReviews(repository(), await configured(), decisions, IDLE, () => AT);
    const decided = await reviews.decide(LIST, { status: "set_aside", reason: "covered", coveredBy: `${FOLDER}/other.spec.ts`, note: "Same steps." });
    const kept = { id: LIST, at: AT.toISOString(), status: "set_aside", reason: "covered", coveredBy: `${FOLDER}/other.spec.ts`, note: "Same steps." };
    assert.deepEqual(decided, { decision: kept });
    assert.deepEqual(await decisions.list(), [kept]);
    await assert.rejects(reviews.decide(LIST, { status: "validated" }), new ReviewRefusedError(`The test ${FOLDER}/list-orders.spec.ts is set aside already.`));
    await assert.rejects(reviews.decide("44444444-4444-4444-8444-444444444444", { status: "validated" }), UnknownProposalError);
  });

  it("validates a test: its file and those its design wrote enter the working branch, committed there, nothing pushed", async () => {
    const root = repository();
    const decisions = new MemoryTestDecisionStore();
    const reviews = new TestReviews(root, await configured(), decisions, IDLE, () => AT);
    assert.deepEqual(await reviews.decide(OPEN, { status: "validated" }), {
      decision: { id: OPEN, status: "validated", at: AT.toISOString() },
      entered: { branch: "main", committed: true },
    });
    assert.equal(git(root, "branch", "--show-current").trim(), "main");
    assert.equal(git(root, "log", "-1", "--format=%s").trim(), "test: keep An order opens");
    assert.deepEqual(git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").toSorted(), [
      "apps/shop/pages/orders-page.ts",
      `${FOLDER}/open-order.spec.ts`,
    ]);
    // The test validated leaves the queue; validated again, it is refused.
    assert.deepEqual(
      (await reviews.queue()).tests.map(({ id }) => id),
      [LIST],
    );
    await assert.rejects(reviews.decide(OPEN, { status: "validated" }), /is validated already\.$/);
    // A test whose files the branch has already as its design wrote them enters it without a commit.
    git(root, "checkout", "oqas/design-20261127T090000Z", "--", `${FOLDER}/list-orders.spec.ts`);
    git(root, "commit", "-q", "-m", "test: take the listing by hand");
    assert.deepEqual((await reviews.decide(LIST, { status: "validated" })).entered, { branch: "main", committed: false });
  });

  it("takes the test into the branch the person works on when the checkout is on the branch of a design", async () => {
    const root = repository();
    git(root, "branch", "feature");
    git(root, "switch", "-q", "oqas/design-20261127T090000Z");
    const reviews = new TestReviews(root, await configured(), new MemoryTestDecisionStore(), IDLE, () => AT);
    // Of several branches that hold where the design started, main is the one.
    assert.deepEqual((await reviews.decide(LIST, { status: "validated" })).entered, { branch: "main", committed: true });
    assert.equal(git(root, "branch", "--show-current").trim(), "main");
  });

  it("refuses to validate while a session runs or waits, while a tracked file is changed, and when no branch of the person stands out", async () => {
    const root = repository();
    const busy = { sessions: () => Promise.resolve([{ state: "queued" }] as never) };
    await assert.rejects(
      new TestReviews(root, await configured(), new MemoryTestDecisionStore(), busy).decide(LIST, { status: "validated" }),
      new ReviewRefusedError("A session runs or waits in the test repository: validate the test once it ended."),
    );
    const reviews = new TestReviews(root, await configured(), new MemoryTestDecisionStore(), IDLE);
    // What the harness writes itself does not stop it; a file of the person does.
    written(root, "oqas.json", "{}\n");
    written(root, "package.json", '{ "changed": true }\n');
    await assert.rejects(
      reviews.decide(LIST, { status: "validated" }),
      /^ReviewRefusedError: Tracked files are changed: package\.json\. Commit them or put them aside, then validate again\.$/,
    );
    git(root, "checkout", "--", "package.json");
    // On the branch of the design, with two branches of the person and no main, none is chosen for them.
    git(root, "branch", "-m", "main", "trunk");
    git(root, "branch", "feature");
    git(root, "switch", "-q", "oqas/design-20261127T090000Z");
    await assert.rejects(
      reviews.decide(LIST, { status: "validated" }),
      /Several branches of yours hold the revision the design started from \(feature, trunk\)/,
    );
    git(root, "branch", "-D", "feature", "trunk");
    await assert.rejects(reviews.decide(LIST, { status: "validated" }), /No branch of yours holds the revision the design started from/);
  });

  it("takes the test into the only branch of the person, from the branch of a design or a detached checkout, and says what git refused", async () => {
    const root = repository();
    git(root, "branch", "-m", "main", "trunk");
    git(root, "switch", "-q", "oqas/design-20261127T090000Z");
    const reviews = new TestReviews(root, await configured(), new MemoryTestDecisionStore(), IDLE, () => AT);
    assert.deepEqual((await reviews.decide(LIST, { status: "validated" })).entered, { branch: "trunk", committed: true });
    git(root, "switch", "-q", "--detach", "HEAD");
    // git commits with the hooks of the repository: one that refuses the commit refuses the validation, with what git said.
    written(root, ".git/hooks/pre-commit", "#!/bin/sh\necho 'The commit is refused by the team.' >&2\nexit 1\n");
    chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
    await assert.rejects(reviews.decide(OPEN, { status: "validated" }), /^ReviewRefusedError: git commit failed: The commit is refused by the team\.$/);
  });
});
