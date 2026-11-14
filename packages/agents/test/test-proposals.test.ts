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
import { TestProposals } from "../src/designer/test-proposals.ts";

const root = mkdtempSync(join(tmpdir(), "oqas-proposals-"));
after(() => rmSync(root, { recursive: true, force: true }));

const STARTED = "2026-11-13T10:00:00.000Z";

/** A scenario of an application whose one step opens it and expects its heading. */
const scenario = (application: string, sources: readonly string[]): PlannedScenario => ({
  id: "open-ledger",
  title: "Open the ledger",
  intent: "Verifies that the ledger opens.",
  kind: "other",
  case: "nominal",
  application,
  domain: "ledger",
  sources: sources.map((source) => ({ source })),
  data: [],
  steps: [{ action: "Open the ledger", expects: [{ result: "The ledger shows", shows: ["Ledger"], absent: [] }] }],
});

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
  const proposals = new TestProposals(
    { repositoryRoot: root, appsDir: "apps", addresses: [], secrets: [], runner: failing, packages: ["@playwright/test"], screens, screenshots: false, reads },
    new Journal(),
  );
  const planned = scenario(application, cited);
  proposals.start({ scenarios: [planned] });
  const content = acted(skeleton(planned, false, () => undefined));
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
    const proposals = new TestProposals(
      {
        repositoryRoot: root,
        appsDir: "apps",
        addresses: [],
        secrets: [],
        runner,
        packages: ["@playwright/test"],
        screens: new ScreenWatch([], []),
        screenshots: false,
        reads: new SourceWatch([], [], []),
      },
      new Journal(),
    );
    const planned = scenario("ledger", []);
    proposals.start({ scenarios: [planned] });
    const content = acted(skeleton(planned, false, () => undefined));
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
    const proposals = new TestProposals(
      {
        repositoryRoot: root,
        appsDir: "apps",
        addresses: [],
        secrets: [],
        runner: passing,
        packages: ["@playwright/test"],
        screens: new ScreenWatch([], []),
        screenshots: false,
        reads: new SourceWatch([], [], []),
      },
      new Journal(),
    );
    const planned = scenario("ledger", []);
    proposals.start({ scenarios: [planned] });
    const content = acted(skeleton(planned, false, () => undefined));
    await proposals.trialTool().execute({ content });
    const told = [];
    for (let at = 0; at < 5; at += 1)
      told.push(await proposals.trialTool().execute({ content: `import { test } from "@playwright/test";\n\ntest("open", async () => {});\n// ${at}\n` }));
    assert.match(
      String(told[4]),
      /^Scenario open-ledger was closed by the harness after 5 refusals for TEST-STEPS, with the test of its last run: passed\. Go on with the next scenario\.\nAll 1 scenarios are closed: 1 passed, 0 failing, 0 closed without a test\./,
    );
    assert.deepEqual(
      proposals.accepted.map(({ verdict, closedBy, content: kept }) => [verdict, closedBy, kept === content]),
      [["passed", "TEST-STEPS", true]],
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
        expects: [{ result: "The profile shows", shows: ["Lena Veldane", "Risk Factor", "Ida Norr"], absent: [] }],
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
  /** The proposals of a scenario whose list showed the customer in a cell, and the screens they rely on. */
  const proposed = async (runner: TestRunner, planned = profile) => {
    const screens = new ScreenWatch(
      ["shop"],
      [
        tool("shop_goto"),
        tool("shop_snapshot", { page: '- heading "Ledger"\n- cell "Lena Veldane"\n- text: Risk Factor\n- textbox "Search": Ida Norr', truncated: false }),
        ...["click", "fill", "select_option", "check"].map((action) => tool(`shop_${action}`)),
      ],
    );
    const proposals = new TestProposals(
      {
        repositoryRoot: root,
        appsDir: "apps",
        addresses: [],
        secrets: [],
        runner,
        packages: ["@playwright/test"],
        screens,
        screenshots: false,
        reads: new SourceWatch([], [], []),
      },
      new Journal(),
    );
    proposals.start({ scenarios: [planned] });
    await screens
      .tools()
      .find((tool) => tool.name === "shop_snapshot")!
      .execute({});
    const content = acted(skeleton(planned, false, (text, gone) => screens.locatorOf("shop", text, gone)));
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
      assert.match((await diagnosed(missed, "application")) as string, /^Scenario open-ledger closed: failing \(application\), kept for a person to decide\./);
    }
  });
});
