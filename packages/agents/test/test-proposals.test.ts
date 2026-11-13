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
const shopTools = () => [tool("shop_goto"), tool("shop_snapshot", { page: '- heading "Ledger"', truncated: false }), ...["click", "fill", "select_option", "check"].map((action) => tool(`shop_${action}`))];

/** A runner whose every test fails on an assertion at the first step. */
const failing: TestRunner = {
  run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "failed", reason: "Error: expect(locator).toBeVisible() failed", failedStep: "1. Open the ledger" }] }),
};

/**
 * What the agent is told of a second run of the test of a scenario, the first having failed and the agent
 * having looked at nothing since.
 */
async function secondRun(application: string, cited: readonly string[], sources: readonly Pick<Knowledge, "id" | "type">[], tools: readonly ToolDefinition[]): Promise<unknown> {
  const screens = new ScreenWatch(["shop"], shopTools());
  const reads = new SourceWatch(sources, tools, []);
  const proposals = new TestProposals({ repositoryRoot: root, appsDir: "apps", addresses: [], secrets: [], runner: failing, packages: ["@playwright/test"], screens, screenshots: false, reads }, new Journal());
  const planned = scenario(application, cited);
  proposals.start({ scenarios: [planned] });
  const content = skeleton(planned, false);
  await proposals.trialTool().execute({ content });
  return proposals.trialTool().execute({ content: `${content}// again\n` });
}

/** The advice of a refusal for TEST-LOOK; none when the run was not refused for it. */
const advice = (told: unknown) => /Refused \(TEST-LOOK\): look before you run again\. (.*)\n/.exec(typeof told === "object" && told !== null && "error" in told ? String(told.error) : "")?.[1];

describe("how the agent is told to look at what a failed run did", () => {
  const logs = { id: "ledger-logs", type: "logs" as const };
  const code = { id: "ledger-code", type: "source-code" as const };
  const guide = { id: "guide", type: "document" as const };
  const specs = { id: "specs", type: "document" as const };
  const sourceTools = [tool("ledger_logs_read_logs"), tool("ledger_code_search"), tool("guide_read_section"), tool("specs_read_section")];

  it("names the snapshot of an application with screens, and the logs when a source holds them", async () => {
    assert.equal(advice(await secondRun("shop", [], [logs], sourceTools)), 'Take shop_snapshot at the step that failed ("1. Open the ledger"), or read the logs since 2026-11-13T10:00:00.000Z with ledger_logs_read_logs.');
  });

  it("names the logs and the code of an application without screens, or else the sources its scenario cites, or else every source", async () => {
    assert.equal(advice(await secondRun("ledger", [], [logs, code, guide], sourceTools)), 'Read the logs since 2026-11-13T10:00:00.000Z with ledger_logs_read_logs, or read the source code with ledger_code_search, at the step that failed ("1. Open the ledger").');
    assert.equal(advice(await secondRun("ledger", ["specs", "specs", "ledger"], [guide, specs], sourceTools)), 'Read what a source tells of the step that failed ("1. Open the ledger"), with specs_read_section.');
    assert.equal(advice(await secondRun("ledger", ["ledger"], [guide, specs], sourceTools)), 'Read what a source tells of the step that failed ("1. Open the ledger"), with guide_read_section or specs_read_section.');
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
    const proposals = new TestProposals({ repositoryRoot: root, appsDir: "apps", addresses: [], secrets: [], runner, packages: ["@playwright/test"], screens: new ScreenWatch([], []), screenshots: false, reads: new SourceWatch([], [], []) }, new Journal());
    const planned = scenario("ledger", []);
    proposals.start({ scenarios: [planned] });
    const content = skeleton(planned, false);
    const [first, second] = await Promise.allSettled([proposals.trialTool().execute({ content }), proposals.trialTool().execute({ content })]);
    assert.deepEqual([first.status, second.status], ["rejected", "fulfilled"]);
    assert.match(String((second as PromiseFulfilledResult<unknown>).value), /^Run of the file: failed\./);
  });
});

describe("the fifth refusal of one reason", () => {
  it("keeps a test whose last run passed as passed, with the code refused", async () => {
    const passing: TestRunner = { run: async (test) => ({ startedAt: STARTED, tests: [{ id: test.path, verdict: "passed", reason: "Every attempt passed." }] }) };
    const proposals = new TestProposals({ repositoryRoot: root, appsDir: "apps", addresses: [], secrets: [], runner: passing, packages: ["@playwright/test"], screens: new ScreenWatch([], []), screenshots: false, reads: new SourceWatch([], [], []) }, new Journal());
    const planned = scenario("ledger", []);
    proposals.start({ scenarios: [planned] });
    const content = skeleton(planned, false);
    await proposals.trialTool().execute({ content });
    const told = [];
    for (let at = 0; at < 5; at += 1) told.push(await proposals.trialTool().execute({ content: `import { test } from "@playwright/test";\n\ntest("open", async () => {});\n// ${at}\n` }));
    assert.match(String(told[4]), /^Scenario open-ledger was closed by the harness after 5 refusals for TEST-STEPS, with the test of its last run: passed\. Go on with the next scenario\.\nAll 1 scenarios are closed: 1 passed, 0 failing, 0 closed without a test\./);
    assert.deepEqual(proposals.accepted.map(({ verdict, closedBy, content: kept }) => [verdict, closedBy, kept === content]), [["passed", "TEST-STEPS", true]]);
  });
});
