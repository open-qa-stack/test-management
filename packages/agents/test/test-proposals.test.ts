import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Knowledge } from "@open-qa-stack/shared";
import type { PlannedScenario, TestRunner, ToolDefinition } from "@open-qa-stack/domain";
import { Journal } from "../src/common/journal.ts";
import { ScreenWatch } from "../src/designer/screen-watch.ts";
import { skeleton } from "../src/designer/scenario-sheet.ts";
import { SourceWatch } from "../src/designer/source-watch.ts";
import { locatorsOf } from "../src/designer/spec-rules.ts";
import type { CoherenceJudge } from "../src/designer/coherence-judge.ts";
import type { CoherenceFinding } from "../src/designer/design-state.ts";
import { TestProposals, type ProposalRules } from "../src/designer/test-proposals.ts";

const root = mkdtempSync(join(tmpdir(), "oqas-proposals-"));
after(() => rmSync(root, { recursive: true, force: true }));

const STARTED = "2026-11-13T10:00:00.000Z";

/** A scenario of an application whose one step opens it and expects its heading. */
const scenario = (application: string, sources: readonly string[]): PlannedScenario => ({
  id: "open-ledger",
  title: "Open the ledger",
  intent: "Verifies that the ledger opens.",
  kind: "other",
  level: "functional",
  effect: "read",
  case: "nominal",
  application,
  domain: "ledger",
  sources: sources.map((source) => ({ source })),
  data: [],
  steps: [{ action: "Open the ledger", code: [], expects: [{ result: "The ledger shows", shows: ["Ledger"], absent: [], elements: [] }] }],
});

/** When the tests of these scenarios are classed. */
const NOW = "2026-11-13T11:00:00.000Z";
/** What the tests are checked against, with the runner given. */
const rules = (runner: TestRunner): ProposalRules => ({
  repositoryRoot: root,
  appsDir: "apps",
  addresses: [],
  secrets: [],
  runner,
  packages: ["@playwright/test"],
  screenshots: false,
  now: () => new Date(NOW),
});
/** A session that sees no screen and reads no source. */
const BLIND = { screens: new ScreenWatch([], []), reads: new SourceWatch([], [], []) };

/** A tool that returns nothing of note. */
const tool = (name: string, result: unknown = {}): ToolDefinition => ({ name, description: name, parameters: { type: "object" }, execute: async () => result });

/** The browser tools of the shop, whose page shows its heading. */
const shopTools = () => [
  tool("shop_goto"),
  tool("shop_snapshot", { page: '- heading "Ledger"', truncated: false }),
  ...["click", "fill", "select_option", "check"].map((action) => tool(`shop_${action}`)),
];

/** The text of a skeleton whose steps open the ledger, as the agent fills it with the line the browser tools return. */
const acted = (content: string) => content.replace(/(\/\/ Do: [^\n]*\n)/g, '$1    await page.goto("/ledger");\n');

/** A runner whose every test fails on an assertion at the first step. */
const failing: TestRunner = {
  run: async (test) => ({
    startedAt: STARTED,
    tests: [{ id: test.path, verdict: "failed", reason: "Error: expect(locator).toBeVisible() failed", failedStep: "1. Open the ledger" }],
  }),
};

/**
 * What the agent is told of a second run of the test of a scenario, the first having failed and the agent
 * having looked at nothing since: it saw the page of the shop before the first.
 */
async function secondRun(
  application: string,
  cited: readonly string[],
  sources: readonly Pick<Knowledge, "id" | "type">[],
  tools: readonly ToolDefinition[],
): Promise<unknown> {
  const screens = new ScreenWatch(["shop"], shopTools());
  const reads = new SourceWatch(sources, tools, []);
  const planned = scenario(application, cited);
  const proposals = new TestProposals(rules(failing), new Journal(), { scenarios: [planned] });
  proposals.begin({ screens, reads });
  const content = acted(skeleton(planned, false));
  await screens
    .tools()
    .find((tool) => tool.name === "shop_snapshot")!
    .execute({});
  await proposals.trialTool().execute({ content });
  return proposals.trialTool().execute({ content: `${content}// again\n` });
}

/** The advice of a refusal for TEST-LOOK; none when the run was not refused for it. */
const advice = (told: unknown) =>
  /Refused \(TEST-LOOK\): look before you run again\. (.*)\n/.exec(typeof told === "object" && told !== null && "error" in told ? String(told.error) : "")?.[1];

describe("how the agent is told to look at what a failed run did", () => {
  const logs = { id: "ledger-logs", type: "logs" as const };
  const code = { id: "ledger-code", type: "source-code" as const };
  const guide = { id: "guide", type: "document" as const };
  const specs = { id: "specs", type: "document" as const };
  const sourceTools = [tool("ledger_logs_read_logs"), tool("ledger_code_search"), tool("guide_read_section"), tool("specs_read_section")];

  it("names the snapshot of an application with screens, and the logs when a source holds them", async () => {
    assert.equal(
      advice(await secondRun("shop", [], [logs], sourceTools)),
      'Take shop_snapshot at the step that failed ("1. Open the ledger"), or read the logs since 2026-11-13T10:00:00.000Z with ledger_logs_read_logs.',
    );
  });

  it("names the logs and the code of an application without screens, or else the sources its scenario cites, or else every source", async () => {
    assert.equal(
      advice(await secondRun("ledger", [], [logs, code, guide], sourceTools)),
      'Read the logs since 2026-11-13T10:00:00.000Z with ledger_logs_read_logs, or read the source code with ledger_code_search, at the step that failed ("1. Open the ledger").',
    );
    assert.equal(
      advice(await secondRun("ledger", ["specs", "specs", "ledger"], [guide, specs], sourceTools)),
      'Read what a source tells of the step that failed ("1. Open the ledger"), with specs_read_section.',
    );
    assert.equal(
      advice(await secondRun("ledger", ["ledger"], [guide, specs], sourceTools)),
      'Read what a source tells of the step that failed ("1. Open the ledger"), with guide_read_section or specs_read_section.',
    );
  });

  it("asks for no look when no tool could give one", async () => {
    const told = await secondRun("ledger", [], [], []);
    assert.equal(advice(told), undefined);
    assert.match(String(told), /^Run of the file: failed\./);
  });
});

describe("the calls that run a test", () => {
  it("run one after the other, a call that threw leaving the next to run", async () => {
    let calls = 0;
    const runner: TestRunner = {
      run: async (test) => {
        calls += 1;
        if (calls === 1) throw new Error("The runner stopped.");
        return failing.run(test);
      },
    };
    const planned = scenario("ledger", []);
    const proposals = new TestProposals(rules(runner), new Journal(), { scenarios: [planned] });
    proposals.begin(BLIND);
    const content = acted(skeleton(planned, false));
    const [first, second] = await Promise.allSettled([proposals.trialTool().execute({ content }), proposals.trialTool().execute({ content })]);
    assert.deepEqual([first.status, second.status], ["rejected", "fulfilled"]);
    assert.match(String((second as PromiseFulfilledResult<unknown>).value), /^Run of the file: failed\./);
  });
});

describe("the fifth refusal of one reason", () => {
  it("keeps a test whose last run passed as passed, with the code refused", async () => {
    const passing: TestRunner = {
      run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }),
    };
    const planned = scenario("ledger", []);
    const proposals = new TestProposals(rules(passing), new Journal(), { scenarios: [planned] });
    proposals.begin(BLIND);
    const content = acted(skeleton(planned, false));
    await proposals.trialTool().execute({ content });
    const told = [];
    for (let at = 0; at < 5; at += 1)
      told.push(await proposals.trialTool().execute({ content: `import { test } from "@playwright/test";\n\ntest("open", async () => {});\n// ${at}\n` }));
    assert.match(
      String(told[4]),
      /^Scenario open-ledger was closed by the harness after 5 refusals for TEST-STEPS, with the test of its last run: passed\.\nNext: answer with one sentence\. Call no more tools\.$/,
    );
    assert.deepEqual(
      proposals.accepted.map(({ verdict, closedBy, content: kept, classes }) => [verdict, closedBy, kept === content, classes]),
      [
        [
          "passed",
          "TEST-STEPS",
          true,
          [
            {
              at: NOW,
              class: "passed",
              origin: { by: "harness", check: "TEST-STEPS" },
              reason: "Its last run passed; the scenario was closed by the harness after 5 refusals for TEST-STEPS.",
            },
          ],
        ],
      ],
    );
  });
});

describe("the page at the failure of a run", () => {
  const PROFILE = [
    '- heading "Customer Profile" [level=4]',
    "- list:",
    "  - listitem: Lena Veldane",
    "  - listitem:",
    '    - link "lena@example.com":',
    "      - /url: mailto:lena@example.com",
    '- textbox "Search": Ida Norr',
    "- text: Risk Factor 45",
  ].join("\n");
  const profile: PlannedScenario = {
    ...scenario("shop", []),
    steps: [
      {
        action: "Open the profile of Lena Veldane",
        code: [],
        expects: [{ result: "The profile shows", shows: ["Lena Veldane", "Risk Factor", "Ida Norr"], absent: [], elements: [] }],
      },
    ],
  };
  /** A runner whose every test fails on an assertion of its first step, the runner giving the page at the failure. */
  const notFound = (locator: string) => `Error: expect(locator).toBeVisible() failed\n\nLocator: ${locator}\nError: element(s) not found`;
  const atPage = (page: string, reason = notFound("getByRole('cell', { name: 'Lena Veldane', exact: true })")): TestRunner => ({
    run: async (test) => ({
      startedAt: STARTED,
      tests: [
        {
          id: test.path,
          verdict: "failed",
          reason,
          failedStep: "1. Open the profile of Lena Veldane",
          page,
        },
      ],
    }),
  });
  /** The proposals of a scenario whose list showed the customer in a cell, as its plan says, and the screens they rely on. */
  const proposed = async (runner: TestRunner, submitted = profile) => {
    const screens = new ScreenWatch(
      ["shop"],
      [
        tool("shop_goto"),
        tool("shop_snapshot", { page: '- heading "Ledger"\n- cell "Lena Veldane"\n- text: Risk Factor\n- textbox "Search": Ida Norr', truncated: false }),
        ...["click", "fill", "select_option", "check"].map((action) => tool(`shop_${action}`)),
      ],
    );
    await screens
      .tools()
      .find((tool) => tool.name === "shop_snapshot")!
      .execute({});
    const element = (text: string) => {
      const shown = screens.locatorOf("shop", text, false);
      return shown === undefined ? [] : [{ text, ...shown }];
    };
    const steps = submitted.steps.map((step) => ({ ...step, expects: step.expects.map((expect) => ({ ...expect, elements: expect.shows.flatMap(element) })) }));
    const planned = { ...submitted, steps };
    const proposals = new TestProposals(rules(runner), new Journal(), { scenarios: [planned] });
    proposals.begin({ screens, reads: new SourceWatch([], [], []) });
    const content = acted(skeleton(planned, false));
    const ran = String(await proposals.trialTool().execute({ content }));
    return { proposals, screens, ran };
  };
  const diagnosed = (proposals: TestProposals, cause: string) =>
    proposals.tool().execute({ diagnosis: { cause, evidence: "The profile does not show the customer." } }) as Promise<string | { error: string }>;

  it("tells the elements that held each text the step expects, beside the fields, and those it showed nowhere", async () => {
    const { ran, screens } = await proposed(atPage(PROFILE));
    assert.ok(
      ran.includes(
        [
          'At the failure, the page showed "Lena Veldane" in:',
          "- listitem: Lena Veldane",
          "Assert it on one of these elements.",
          'At the failure, the page showed "Risk Factor" in:',
          "- text: Risk Factor 45",
          "Assert it on one of these elements.",
          'At the failure, the page showed "Ida Norr" nowhere beside the fields.',
          "Failed runs of open-ledger: 1 of 3.",
        ].join("\n"),
      ),
      ran,
    );
    // The page at the failure is one the screens showed: a locator of one of its elements is no unseen one.
    assert.deepEqual(screens.unseen("shop", [{ code: 'getByRole("listitem")', role: "listitem", text: "Lena Veldane" }]), []);
  });

  it("refuses the cause application or plan when the page showed what an assertion that found nothing looked for, and keeps one it did not show", async () => {
    const planned = { ...profile, steps: [{ ...profile.steps[0]!, expects: [{ ...profile.steps[0]!.expects[0]!, shows: ["Lena Veldane", "Risk Factor"] }] }] };
    const { proposals } = await proposed(atPage(PROFILE), planned);
    const refused = (await diagnosed(proposals, "plan")) as { error: string };
    assert.equal(
      refused.error,
      [
        'Refused (PROPOSE-CAUSE): cause "plan" does not fit: at the failure of step "1. Open the profile of Lena Veldane", the assertion found no element, and the page showed what it looked for ("Lena Veldane" in - listitem: Lena Veldane). The application shows it, and the assertion looks for it in another element: point it at that element with run_test, such as await expect(page.getByRole("listitem").filter({ hasText: "Lena Veldane" })).toBeVisible(); Once no run is left, give cause "test".',
        "Nothing else was refused.",
      ].join("\n"),
    );
    const kept = [
      // A text the assertion looked for that the page did not show beside the fields.
      { runner: atPage(PROFILE, notFound("getByText('Ida Norr')")), planned: profile },
      // A matcher of the page, which found no element of it.
      { runner: atPage(PROFILE, "Error: expect(page).toHaveURL(expected) failed\n\nExpected pattern: /profiles/"), planned },
      // A text the step expects gone that the page still showed.
      {
        runner: atPage(PROFILE),
        planned: { ...planned, steps: [{ ...planned.steps[0]!, expects: [{ ...planned.steps[0]!.expects[0]!, absent: ["Risk Factor"] }] }] },
      },
    ];
    for (const { runner, planned: closed } of kept) {
      const { proposals: missed } = await proposed(runner, closed);
      await diagnosed(missed, "application");
      assert.match((await diagnosed(missed, "application")) as string, /^Scenario open-ledger closed: failing \(application\), kept for a person to decide\./);
    }
  });
});

describe("the locators of a test", () => {
  const OPENED = 'await page.goto("/ledger");';
  const HEADING = 'page.getByRole("heading", { name: "Ledger", exact: true })';
  /** A scenario of the shop as a plan keeps it: with the code of its step and the element of its text. */
  const planned: PlannedScenario = {
    ...scenario("shop", []),
    steps: [
      {
        action: "Open the ledger",
        code: [OPENED],
        expects: [{ result: "The ledger shows", shows: ["Ledger"], absent: [], elements: [{ text: "Ledger", locator: HEADING, field: false }] }],
      },
    ],
  };
  const passing: TestRunner = {
    run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }),
  };
  /** The proposals of a session that looked at no screen, as one that resumes a design, and its screens. */
  const resumed = () => {
    const screens = new ScreenWatch(["shop"], shopTools());
    const proposals = new TestProposals(rules(passing), new Journal(), { scenarios: [planned] });
    const sheet = proposals.sheet!;
    proposals.begin({ screens, reads: new SourceWatch([], [], []) });
    return { proposals, screens, sheet };
  };

  it("are those of the skeleton of its scenario, which the plan gives: a test made of its lines alone runs in a session that saw no screen", async () => {
    const { proposals, sheet } = resumed();
    const content = skeleton(planned, false);
    assert.ok(sheet.includes(content));
    assert.ok(content.includes(`    ${OPENED}\n    // Expect 1.1: The ledger shows.\n    await expect(${HEADING}).toBeVisible();`), content);
    assert.match(String(await proposals.trialTool().execute({ content })), /^Run of the file: passed\./);
    // The same element, written another way, is the one of the plan still.
    const { proposals: again } = resumed();
    const reworded = content.replace(HEADING, 'page.getByRole("heading", { name: "Ledger" })');
    assert.notEqual(reworded, content);
    assert.match(String(await again.trialTool().execute({ content: reworded })), /^Run of the file: passed\./);
  });

  it("are else ones a screen of the session showed: another is refused until the agent looked", async () => {
    const { proposals, screens } = resumed();
    const other = skeleton(planned, false).replace(HEADING, 'page.getByRole("banner").getByText("Ledger")');
    assert.deepEqual(await proposals.trialTool().execute({ content: other }), {
      error:
        'Refused (TEST-LOCATOR): no screen you looked at showed getByText("Ledger"), getByRole("banner").\nCopy a locator as given, or take shop_snapshot at that step.\nNothing else was refused.',
    });
    await screens
      .tools()
      .find((tool) => tool.name === "shop_snapshot")!
      .execute({});
    const heading = skeleton(planned, false).replace(HEADING, 'page.getByRole("heading").getByText("Ledger")');
    assert.match(String(await proposals.trialTool().execute({ content: heading })), /^Run of the file: passed\./);
  });

  it("are read from a text that parses, and none from one that does not", async () => {
    assert.deepEqual(await locatorsOf(skeleton(planned, false)), [
      { code: 'getByRole("heading", { name: "Ledger", exact: true })', role: "heading", text: "Ledger" },
    ]);
    assert.deepEqual(await locatorsOf('test("open", async ({ page }) => { await page.getByRole("heading"'), []);
  });
});

describe("the session of a scenario", () => {
  const passing: TestRunner = {
    run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }),
  };
  const first = scenario("ledger", []);
  const second = { ...first, id: "close-ledger" };
  const CLOSED = {
    error: "Refused (SCENARIO-CLOSED): the scenario of this session is closed. Answer with one sentence; call no more tools.\nNothing else was refused.",
  };
  const written = acted(skeleton(first, false));

  it("is the only one that may run and close its scenario: before it begins, and once the scenario is closed, every call is refused", async () => {
    const journal = new Journal();
    const proposals = new TestProposals(rules(passing), journal, { scenarios: [first, second] });
    assert.deepEqual([proposals.writing, proposals.reminder()], [false, undefined]);
    assert.deepEqual([await proposals.trialTool().execute({ content: written }), await proposals.tool().execute({})], [CLOSED, CLOSED]);
    assert.match(proposals.sheet!, /^Scenario 1 of 2: open-ledger /);
    proposals.begin(BLIND);
    assert.equal(proposals.writing, true);
    await proposals.trialTool().execute({ content: written });
    // The agent is told its session is over, not the sheet of the next scenario.
    assert.equal(await proposals.tool().execute({}), "Scenario open-ledger closed: passed.\nNext: answer with one sentence. Call no more tools.");
    assert.deepEqual([proposals.writing, proposals.reminder(), await proposals.trialTool().execute({ content: written })], [false, undefined, CLOSED]);
    assert.match(proposals.sheet!, /^Scenario 2 of 2: close-ledger /);
    assert.deepEqual(proposals.accepted[0]!.classes, [
      { at: NOW, class: "passed", origin: { by: "harness", check: "run_test" }, reason: "Its last run passed." },
    ]);
    assert.deepEqual(
      journal.entries().map((entry) => entry.message),
      [
        "The scenario open-ledger was opened; its test is apps/ledger/open-ledger.spec.ts.",
        "The test apps/ledger/open-ledger.spec.ts was run: passed.",
        "The scenario open-ledger was closed: passed; its test is apps/ledger/open-ledger.spec.ts.",
      ],
    );
  });

  it("asks once about a test that runs what the test of another scenario runs, keeps it as a duplicate when the agent closes it as it is, and as passed once it runs something of its own", async () => {
    const journal = new Journal();
    const third = { ...first, id: "audit-ledger" };
    const proposals = new TestProposals(rules(passing), journal, { scenarios: [first, second, third] });
    const OVER = "Next: answer with one sentence. Call no more tools.";
    const kept = "apps/ledger/open-ledger.spec.ts";
    const warning = (id: string) =>
      `Warning (TEST-DUPLICATE): the test of scenario ${id} runs the same actions and the same assertions as ${kept}, the test of another scenario. Is it still the test of its sheet? Check it against the steps and the expected texts of the sheet, put back what was taken out of it, and run it again with run_test. If the sheet gives this very test, call propose_test again as it is: it is then kept as a duplicate of ${kept}.`;
    proposals.begin(BLIND);
    await proposals.trialTool().execute({ content: written });
    await proposals.tool().execute({});
    // Another title, a comment and another layout change nothing of what a test runs.
    proposals.begin(BLIND);
    await proposals
      .trialTool()
      .execute({ content: `// The same, under another name.\n${written.replace('test("Open the ledger"', "test('Close the ledger'")}\n` });
    assert.equal(await proposals.tool().execute({}), warning("close-ledger"));
    assert.equal(proposals.writing, true);
    assert.equal(await proposals.tool().execute({}), `Scenario close-ledger closed: kept as a duplicate of ${kept}, and left out of the tests run.\n${OVER}`);
    const { verdict, classes, duplicates } = proposals.accepted[1]!;
    assert.deepEqual(
      [verdict, duplicates, classes],
      [
        "passed",
        kept,
        [
          {
            at: NOW,
            class: "duplicate",
            origin: { by: "harness", check: "TEST-DUPLICATE" },
            reason: `It runs the same actions and the same assertions as ${kept}; the agent that wrote it kept it so once warned.`,
          },
        ],
      ],
    );
    // Once warned, the agent puts back what its test alone does: it is a test of its own, compared with those that stand only.
    proposals.begin(BLIND);
    await proposals.trialTool().execute({ content: written });
    assert.equal(await proposals.tool().execute({}), warning("audit-ledger"));
    await proposals.trialTool().execute({ content: written.replace('await page.goto("/ledger");', 'await page.goto("/ledger");\n    await page.reload();') });
    assert.equal(await proposals.tool().execute({}), `Scenario audit-ledger closed: passed.\n${OVER}`);
    assert.deepEqual(
      proposals.accepted.map((test) => [test.classes.at(-1)!.class, test.duplicates]),
      [
        ["passed", undefined],
        ["duplicate", kept],
        ["passed", undefined],
      ],
    );
    assert.ok(
      journal
        .entries()
        .some(
          (entry) => entry.message === `The harness warned the agent that the test of close-ledger runs the same actions and the same assertions as ${kept}.`,
        ),
    );
  });

  it("starts from the first scenario an earlier design did not close, and has no sheet once all are closed", () => {
    const proposals = new TestProposals(rules(passing), new Journal(), { scenarios: [first, second] }, 1);
    assert.match(proposals.sheet!, /^Scenario 2 of 2: close-ledger /);
    proposals.begin(BLIND);
    proposals.giveUp("SESSION-END");
    assert.equal(proposals.sheet, undefined);
  });

  it("classes a test kept failing by who is at fault, as the agent diagnosed it", async () => {
    const proposals = new TestProposals(rules(failing), new Journal(), { scenarios: [first] });
    proposals.begin(BLIND);
    await proposals.trialTool().execute({ content: written });
    const blamed = () => proposals.tool().execute({ diagnosis: { cause: "application", evidence: "The ledger does not open." } });
    // With runs left, a failure held to be that of the application is confirmed once: the plan was accepted on what the application showed.
    const asked = (await blamed()) as { error: string };
    assert.match(
      asked.error,
      /^Refused \(PROPOSE-CONFIRM\): the run failed[^]*compare the test with the plan[^]*repair the test with run_test \(failed runs: 1 of \d\)[^]*call propose_test again with the same diagnosis: that confirms it\./,
    );
    assert.equal(proposals.accepted.length, 0);
    await blamed();
    assert.deepEqual(
      proposals.accepted.map(({ verdict, classes }) => [verdict, classes]),
      [["failed", [{ at: NOW, class: "failing-application", origin: { by: "agent", role: "writer" }, reason: "The ledger does not open." }]]],
    );
  });
});

describe("a scenario whose session ends before it is closed", () => {
  const passing: TestRunner = {
    run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }),
  };
  const planned = scenario("ledger", []);
  const written = acted(skeleton(planned, false));
  const given = (runner: TestRunner) => {
    const journal = new Journal();
    const proposals = new TestProposals(rules(runner), journal, { scenarios: [planned] });
    proposals.begin(BLIND);
    return { proposals, journal };
  };

  it("keeps the skeleton as an unfinished test when nothing was submitted", () => {
    const { proposals, journal } = given(passing);
    proposals.giveUp("SESSION-END");
    assert.deepEqual(proposals.accepted, [
      {
        path: "apps/ledger/open-ledger.spec.ts",
        scenario: "open-ledger",
        verdict: "not_run",
        classes: [
          {
            at: NOW,
            class: "unfinished",
            origin: { by: "harness", check: "SESSION-END" },
            reason: "Its session ended before the scenario was closed. Tried: no run; no refusal.",
          },
        ],
        runs: [],
        closedBy: "SESSION-END",
        content: skeleton(planned, false),
        references: [],
      },
    ]);
    assert.deepEqual([proposals.writing, proposals.sheet], [false, undefined]);
    assert.equal(
      journal.entries().at(-1)!.message,
      "The scenario open-ledger was closed by the harness (SESSION-END): its test is kept as unfinished: apps/ledger/open-ledger.spec.ts.",
    );
  });

  it("keeps the last text submitted that a test may hold, with its verdict when it ran, and what was tried", async () => {
    const { proposals } = given(failing);
    await proposals.trialTool().execute({ content: written });
    // A text the gates of the scenario refuse is one a test may hold; one that does not parse is not.
    const one = `import { test } from "@playwright/test";\n\ntest("open", async () => {});\n`;
    await proposals.trialTool().execute({ content: one });
    await proposals.trialTool().execute({ content: "test(" });
    proposals.giveUp("SESSION-END");
    const [kept] = proposals.accepted;
    assert.deepEqual(
      [kept!.content, kept!.verdict, kept!.classes[0]!.class, kept!.classes[0]!.reason],
      [
        // The harness wrote on it the tags of its scenario.
        one.replace('test("open", ', 'test("open", { tag: ["@level-functional","@domain-ledger","@app-ledger","@kind-other","@case-nominal","@data-read"] }, '),
        "not_run",
        "unfinished",
        'Its session ended before the scenario was closed. Tried: 1 run (failed on assertion at "1. Open the ledger"); refusals: TEST-STEPS ×1, TEST-VALUE ×1, TEST-SYNTAX ×1.',
      ],
    );
    // The text that ran last, kept unfinished, has the verdict of its run.
    const { proposals: ran } = given(failing);
    await ran.trialTool().execute({ content: written });
    ran.giveUp("SESSION-END");
    assert.deepEqual(
      [ran.accepted[0]!.content, ran.accepted[0]!.verdict, ran.accepted[0]!.runs],
      [written, "failed", [{ verdict: "failed", errorClass: "assertion", failedStep: "1. Open the ledger" }]],
    );
  });

  it("keeps a test whose last run passed as passed: the agent only left it open", async () => {
    const { proposals, journal } = given(passing);
    await proposals.trialTool().execute({ content: written });
    proposals.giveUp("SESSION-END");
    assert.deepEqual(
      proposals.accepted.map(({ verdict, closedBy, classes }) => [verdict, closedBy, classes]),
      [
        [
          "passed",
          "SESSION-END",
          [
            {
              at: NOW,
              class: "passed",
              origin: { by: "harness", check: "SESSION-END" },
              reason: "Its last run passed; its session ended before the agent closed the scenario.",
            },
          ],
        ],
      ],
    );
    assert.equal(
      journal.entries().at(-1)!.message,
      "The scenario open-ledger was closed by the harness (SESSION-END): passed; its test is apps/ledger/open-ledger.spec.ts.",
    );
  });

  it("keeps as unfinished the test of a scenario the fifth refusal closes before any run gave a verdict", async () => {
    const { proposals } = given(passing);
    const told = [];
    for (let at = 0; at < 5; at += 1)
      told.push(await proposals.trialTool().execute({ content: `import { test } from "@playwright/test";\n\ntest("open", async () => {});\n// ${at}\n` }));
    assert.equal(
      told[4],
      "Scenario open-ledger was closed by the harness after 5 refusals for TEST-STEPS; its test is kept as unfinished.\nNext: answer with one sentence. Call no more tools.",
    );
    const [kept] = proposals.accepted;
    assert.deepEqual(
      [kept!.verdict, kept!.closedBy, kept!.classes[0]!.origin, kept!.classes[0]!.reason, kept!.content.endsWith("// 4\n")],
      [
        "not_run",
        "TEST-STEPS",
        { by: "harness", check: "TEST-STEPS" },
        "The harness closed the scenario after 5 refusals for TEST-STEPS. Tried: no run; refusals: TEST-STEPS ×5, TEST-VALUE ×5.",
        true,
      ],
    );
  });
});

describe("a test that writes data, run again once it passed", () => {
  const writing = { ...scenario("ledger", []), effect: "write" as const };
  const written = acted(skeleton(writing, false));
  /** A runner whose runs end as given, in order, the last one for every run after. */
  const runner = (...verdicts: ("passed" | "failed" | "error")[]) => {
    const runs: string[] = [];
    const run: TestRunner["run"] = async (test) => {
      const verdict = verdicts[Math.min(runs.length, verdicts.length - 1)]!;
      runs.push(verdict);
      if (verdict === "error") return { startedAt: STARTED, tests: [], error: "The browser did not start." };
      return {
        startedAt: STARTED,
        tests: [{ id: test.path, verdict, reason: verdict === "passed" ? "Every attempt passed." : "Error: expect(locator).toBeVisible() failed" }],
      };
    };
    return { runs, runner: { run } };
  };
  const tried = async (planned: PlannedScenario, ...verdicts: ("passed" | "failed" | "error")[]) => {
    const { runs, runner: given } = runner(...verdicts);
    const journal = new Journal();
    const proposals = new TestProposals(rules(given), journal, { scenarios: [planned] });
    proposals.begin(BLIND);
    const told = String(await proposals.trialTool().execute({ content: acted(skeleton(planned, false)) }));
    return { runs, told, journal: journal.entries().map((entry) => entry.message) };
  };

  it("passes when both runs pass, and is run once when it only reads or did not pass", async () => {
    const twice = await tried(writing, "passed");
    assert.deepEqual([twice.runs, twice.told.startsWith("Run of the file: passed.")], [["passed", "passed"], true]);
    assert.deepEqual((await tried(scenario("ledger", []), "passed")).runs, ["passed"]);
    assert.deepEqual((await tried(writing, "failed")).runs, ["failed"]);
    assert.ok(written.includes('"@data-write"'));
  });

  it("fails, and says why, when the run right after the one that passed fails or cannot run", async () => {
    const replayed = await tried(writing, "passed", "failed");
    assert.deepEqual(replayed.runs, ["passed", "failed"]);
    assert.match(
      replayed.told,
      /^The test passed, then failed when it was run again right after: it relies on data its own run changed\. Enter data of its own, such as a made-up value no other run uses, or add a last step that puts back what the test changed, then call run_test\.\nRun of the file: failed\./,
    );
    assert.ok(replayed.journal.includes("The test apps/ledger/open-ledger.spec.ts writes data, and failed when it was run again after it passed."));
    const broken = await tried(writing, "passed", "error");
    assert.match(
      broken.told,
      /^The test passed, then failed when it was run again right after: [^]*\nRun of the file: it could not run: The browser did not start\./,
    );
  });
});

describe("a scenario the agent that writes it gives up", () => {
  const planned = scenario("ledger", []);
  const given = (runner: TestRunner, secrets: ProposalRules["secrets"] = []) => {
    const journal = new Journal();
    const proposals = new TestProposals({ ...rules(runner), secrets }, journal, { scenarios: [planned] });
    proposals.begin(BLIND);
    const giveUp = (reason: string) => proposals.tool().execute({ unfeasible: { reason } }) as Promise<string | { error: string }>;
    return { proposals, journal, giveUp, run: () => proposals.trialTool().execute({ content: acted(skeleton(planned, false)) }) };
  };
  const passing: TestRunner = { run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }) };
  const REASON = "The ledger offers no way to open an entry.";

  it("is asked once to confirm, then kept without a test, with the reason the agent gave", async () => {
    const { proposals, journal, giveUp, run } = given(failing);
    await run();
    assert.match(
      (await giveUp(REASON)) as string,
      /^Warning \(PROPOSE-UNFEASIBLE\): giving up leaves scenario open-ledger without a test\. If a repair is possible [^]* call propose_test again the same way: that confirms it\.$/,
    );
    assert.equal(proposals.accepted.length, 0);
    assert.match((await giveUp(REASON)) as string, /^Scenario open-ledger closed without a test: no test can do what it asks, as you said\./);
    assert.deepEqual(
      proposals.accepted.map(({ verdict, classes, closedBy }) => [verdict, classes, closedBy]),
      [["failed", [{ at: NOW, class: "unfeasible", origin: { by: "agent", role: "writer" }, reason: REASON }], "PROPOSE-UNFEASIBLE"]],
    );
    assert.ok(journal.entries().some((entry) => entry.message === `The scenario open-ledger was given up by the agent that writes it: ${REASON}`));
    // Once its scenario is closed, the session has nothing left to give up.
    assert.ok("error" in ((await giveUp(REASON)) as object));
  });

  it("is given up before any run as well, its skeleton kept as the text it had", async () => {
    const { proposals, giveUp } = given(failing);
    await giveUp(REASON);
    await giveUp(REASON);
    assert.deepEqual(
      proposals.accepted.map(({ verdict, content }) => [verdict, content]),
      [["not_run", skeleton(planned, false)]],
    );
  });

  it("is not given up once its test passed, nor with a reason that holds a secret", async () => {
    const done = given(passing);
    await done.run();
    assert.deepEqual(await done.giveUp(REASON), {
      error:
        "Refused (PROPOSE-UNFEASIBLE): the test of scenario open-ledger passed. Close it with propose_test, without unfeasible.\nNothing else was refused.",
    });
    const leaky = given(failing, [{ variable: "LEDGER_DB_URL", value: "postgresql://u:p@h/ledger" }]);
    const refused = (await leaky.giveUp("It reads postgresql://u:p@h/ledger.")) as { error: string };
    assert.match(refused.error, /^Refused \(PROPOSE-SECRET\): the reason holds the value of LEDGER_DB_URL\. Leave it out\./);
  });
});

describe("a test that passed, read against its scenario by the coherence reviewer", () => {
  const planned = scenario("ledger", []);
  const passing: TestRunner = { run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }) };
  const FOUND = [{ where: "step 1", what: "No assertion verifies that the ledger opens." }];
  /** A design of one scenario whose reviewer answers as given, in order, the last answer for every review after. */
  const reviewedBy = (...answers: (readonly CoherenceFinding[] | Error)[]) => {
    const asked: string[] = [];
    const journal = new Journal();
    const coherence: CoherenceJudge = {
      judge: async (_scenario, test) => {
        const answer = answers[Math.min(asked.length, answers.length - 1)]!;
        asked.push(test);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    };
    const proposals = new TestProposals({ ...rules(passing), coherence }, journal, { scenarios: [planned] });
    proposals.begin(BLIND);
    const run = (mark = "") => proposals.trialTool().execute({ content: `${acted(skeleton(planned, false))}${mark}` });
    const propose = () => proposals.tool().execute({}) as Promise<string | { error: string }>;
    return { proposals, asked, journal, run, propose };
  };

  it("is kept at once, with its review, when the reviewer finds nothing", async () => {
    const { proposals, asked, run, propose } = reviewedBy([]);
    await run();
    assert.match((await propose()) as string, /^Scenario open-ledger closed: passed\./);
    assert.deepEqual([asked.length, proposals.accepted[0]!.review], [1, { at: NOW, findings: [] }]);
  });

  it("is told once what the reviewer found, then kept with those findings when the agent proposes it again as it is", async () => {
    const { proposals, asked, journal, run, propose } = reviewedBy(FOUND);
    await run();
    assert.equal(
      await propose(),
      [
        "Warning (TEST-COHERENCE): another agent read the test of scenario open-ledger against its sheet, and says it does not do or verify all of it:",
        "- step 1: No assertion verifies that the ledger opens.",
        "Check each against the sheet. Where it is right, fix the test and run it again with run_test. If the test is right as it is, call propose_test again: it is kept, with these findings, for a person to decide.",
      ].join("\n"),
    );
    assert.equal(proposals.accepted.length, 0);
    assert.match((await propose()) as string, /^Scenario open-ledger closed: passed\./);
    // The same text is not reviewed again; its test stays passed, the findings kept with it.
    assert.deepEqual([asked.length, proposals.accepted[0]!.classes.at(-1)!.class, proposals.accepted[0]!.review], [1, "passed", { at: NOW, findings: FOUND }]);
    assert.ok(
      journal
        .entries()
        .some(
          (entry) => entry.message === "The coherence reviewer found fault with the test of open-ledger: step 1: No assertion verifies that the ledger opens.",
        ),
    );
  });

  it("is reviewed again once its text changed, and kept with what the reviewer then says, without another warning", async () => {
    const { proposals, asked, run, propose } = reviewedBy(FOUND, FOUND);
    await run();
    await propose();
    await run("// repaired\n");
    assert.match((await propose()) as string, /^Scenario open-ledger closed: passed\./);
    assert.deepEqual([asked.length, proposals.accepted[0]!.review!.findings], [2, FOUND]);
  });

  it("is kept without a review when the reviewer fails, and the journal says so", async () => {
    const { proposals, journal, run, propose } = reviewedBy(new Error("the review ended without a report."));
    await run();
    assert.match((await propose()) as string, /^Scenario open-ledger closed: passed\./);
    assert.equal(proposals.accepted[0]!.review, undefined);
    assert.ok(
      journal
        .entries()
        .some(
          (entry) =>
            entry.message === "The review of the test of open-ledger for coherence failed, and the test goes on without it: the review ended without a report.",
        ),
    );
  });
});
