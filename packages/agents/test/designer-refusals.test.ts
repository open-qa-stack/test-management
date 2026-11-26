import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, type ScriptedServer } from "@open-qa-stack/testing";
import type { TestRunner } from "@open-qa-stack/domain";
import { testPackages } from "../src/designer/spec-rules.ts";
import {
  MODEL,
  git,
  KNOWLEDGE_BASE,
  repository,
  spec,
  tagged,
  IDS,
  run,
  close,
  DONE,
  write,
  valid,
  replies,
  look,
  broken,
  FakeTestRunner,
  design,
  messages,
  filesOf,
  asked,
  OVER,
  toolResult,
  told,
  stateOf,
  specsOf,
  StepRunner,
} from "./designer-support.ts";

describe("refusals for the same reason", () => {
  it("give what the gate would accept from the third, start again after a run, and close the scenario at the fifth", async () => {
    const flat = (marker: string) => `import { test } from "../../../../shared/fixtures.ts";\n\ntest("list", async () => {});\n// ${marker}\n`;
    const turns = [
      ...["1", "2", "3"].map((marker) => [run(flat(marker), `s${marker}`)]),
      [run(broken("list-orders"), "ran")],
      [look("l1")],
      ...["4", "5", "6", "7", "8"].map((marker) => [run(flat(marker), `s${marker}`)]),
      DONE,
      ...["1", "2", "3", "4", "5"].map((marker) => [run(flat(marker), `p${marker}`)]),
      DONE,
      ...valid(3).slice(6),
    ];
    const { outcome, root, server } = await design(replies(turns));
    assert.match(told(server, "s2"), /^Refused \(TEST-STEPS\): .*\nRefused \(TEST-VALUE\): .*\nNothing else was refused\.$/);
    const sheet = asked(server, 1);
    const skeletonText = sheet.slice(sheet.indexOf("import "), sheet.lastIndexOf("\nNext:"));
    assert.equal(told(server, "s3"), `Third refusal for the same reason. Do this:\n${skeletonText}`);
    // A run starts the count again.
    assert.match(told(server, "s5"), /^Refused \(TEST-STEPS\): /);
    assert.match(told(server, "s7"), /^Fourth refusal for the same reason\. Do this:\nimport /);
    // The test that ran to a verdict before the refusals is kept as it ended.
    assert.equal(
      told(server, "s8"),
      `Scenario list-orders was closed by the harness after 5 refusals for TEST-STEPS, with the test of its last run: failing (test), kept for a person to decide.\n${OVER}`,
    );
    assert.match(
      messages(outcome),
      /The scenario list-orders was closed by the harness after 5 refusals for TEST-STEPS; the test of its last run that gave a verdict is kept, failing \(test\), kept for a person to decide: apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts\./,
    );
    // A scenario whose test never ran keeps its skeleton, as unfinished: no text the gates refused reaches the repository.
    assert.equal(
      told(server, "p5"),
      `Scenario place-order was closed by the harness after 5 refusals for TEST-STEPS; its test is kept as unfinished.\n${OVER}`,
    );
    assert.match(
      messages(outcome),
      /The scenario place-order was closed by the harness \(TEST-STEPS\): its test is kept as unfinished: apps\/shop\/tests\/orders\/listing\/place-order\.spec\.ts\./,
    );
    const state = stateOf(outcome);
    assert.deepEqual(
      [outcome.ok, specsOf(root), state.tests.map((test) => test.classes.at(-1)!.class), state.tests[1]!.closedBy],
      [
        false,
        [
          "apps/shop/tests/orders/listing/follow-order.spec.ts",
          "apps/shop/tests/orders/listing/list-orders.spec.ts",
          "apps/shop/tests/orders/listing/place-order.spec.ts",
        ],
        ["failing-test", "unfinished", "passed"],
        "TEST-STEPS",
      ],
    );
    const placed = readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "place-order.spec.ts"), "utf8");
    assert.deepEqual([placed.includes("await test.step("), placed.includes("// 5")], [true, false]);
    assert.deepEqual(state.tests[0]!.classes, [
      {
        at: "2026-11-13T10:00:00.000Z",
        class: "failing-test",
        origin: { by: "harness", check: "TEST-STEPS" },
        reason: "The scenario was closed by the harness after 5 refusals for TEST-STEPS.",
      },
    ]);
    assert.deepEqual(
      [state.tests[0]!.closedBy, state.tests[0]!.quarantine],
      [
        "TEST-STEPS",
        { cause: "test", evidence: "closed by the harness after 5 refusals for TEST-STEPS", failedStep: "open the orders", errorClass: "assertion" },
      ],
    );
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "utf8"), tagged(broken("list-orders")));
  });

  it("keep a failing test whose closing the agent kept asking for the wrong way, as failing, for the code refused", async () => {
    const failing = (marker: string) => `${broken("list-orders")}// ${marker}\n`;
    const runner = new StepRunner();
    const runs = [[run(failing("1"), "f1")], [look("l1")], [run(failing("2"), "f2")], [look("l2")], [run(failing("3"), "f3")]];
    const again = ["1", "2", "3", "4", "5"].map((marker) => [run(failing(`again ${marker}`), `a${marker}`)]);
    const stopped = await design(replies([...runs, ...again]), { runner });
    assert.match(
      told(stopped.server, "a5"),
      /^Scenario list-orders was closed by the harness after 5 refusals for TEST-STOP, with the test of its last run: failing \(test\), kept for a person to decide\./,
    );
    const kept = stateOf(stopped.outcome).tests[0]!;
    assert.deepEqual(
      [kept.verdict, kept.closedBy, kept.quarantine?.evidence, kept.runs.length, runner.runs.length],
      ["failed", "TEST-STOP", "closed by the harness after 5 refusals for TEST-STOP", 3, 3],
    );
    const blamed = ["1", "2", "3", "4", "5"].map((marker) => [close(`b${marker}`, { cause: "application", evidence: "The search does nothing." })]);
    const located = await design(replies([[run(`${failing("1")}// LOCATOR\n`, "f1")], ...blamed]), { runner: new StepRunner() });
    assert.match(
      told(located.server, "b5"),
      /^Scenario list-orders was closed by the harness after 5 refusals for PROPOSE-CAUSE, with the test of its last run: failing \(test\)/,
    );
    assert.deepEqual(
      stateOf(located.outcome)
        .tests.slice(0, 1)
        .map((test) => [test.closedBy, test.quarantine?.errorClass]),
      [["PROPOSE-CAUSE", "locator"]],
    );
  });
});

describe("what a run tells the agent", () => {
  it("cuts a long error, and counts a file whose run gives no test as not run", async () => {
    const long: TestRunner = {
      run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict: "failed", reason: "x".repeat(5000) }] }),
    };
    const cut = await design(replies(valid(1)), { runner: long as FakeTestRunner });
    const told = toolResult(cut.server, "r-list-orders");
    assert.ok(told.includes(`${"x".repeat(1500)}…`) && !told.includes("x".repeat(1501)) && !told.includes("Failed step"));
    const empty: TestRunner = { run: async () => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [] }) };
    const none = await design(replies(valid(1)), { runner: empty as FakeTestRunner });
    assert.match(toolResult(none.server, "r-list-orders"), /Run of the file: not_run\./);
    assert.deepEqual([none.outcome.tests[0]!.verdict, none.outcome.tests[0]!.classes[0]!.class], ["not_run", "unfinished"]);
  });
});

describe("what the designer may keep", () => {
  it("keeps a passing test as passed whatever the diagnosis claims", async () => {
    const { outcome } = await design(
      replies([...valid(2), ...write("follow-order", spec("follow-order"), { cause: "application", evidence: "The service returns no total." })]),
    );
    const kept = outcome.tests.find((test) => test.scenario === "follow-order");
    assert.deepEqual([kept?.verdict, kept !== undefined && "quarantine" in kept], ["passed", false]);
  });

  it("never keeps a test that did not run to a verdict, even with a diagnosis", async () => {
    for (const verdict of ["skipped", "blocked"] as const) {
      const runner: TestRunner = {
        run: async (test) => ({ startedAt: "2026-11-13T10:00:00.000Z", tests: [{ id: `shop › ${test.path} › t`, verdict, reason: "x" }] }),
      };
      const { outcome, server } = await design(
        replies(write("list-orders", spec("list-orders"), { cause: "application", evidence: "The application is down." })),
        { runner: runner as FakeTestRunner },
      );
      // A test whose run gave no verdict is kept as unfinished, never as passed nor as failing by a diagnosis.
      assert.deepEqual(
        outcome.tests.map((test) => [test.verdict, test.classes[0]!.class, "quarantine" in test]),
        IDS.map(() => ["not_run", "unfinished", false]),
        verdict,
      );
      assert.match(toolResult(server, "c-list-orders"), /Refused \(PROPOSE-RUN\): scenario list-orders has not run to a verdict/);
    }
  });

  it("refuses a test that writes a file, without running it", async () => {
    const runner = new FakeTestRunner();
    const writes = spec("list-orders").replace("  });\n", '    await page.screenshot({ path: "/tmp/x.png" });\n  });\n');
    const { outcome } = await design(replies([[run(writes, "r1")], ...valid(3)]), { runner });
    assert.match(
      messages(outcome),
      /\[TEST-FILE\] The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not be run: The test writes a file/,
    );
    assert.ok(runner.runs.every((test) => !test.content.includes("screenshot")));
  });
});

describe("a visual test", () => {
  it("is run and kept: it opens a page and compares a full capture with its reference", async () => {
    const runner = new FakeTestRunner();
    const visual = `import { test, expect } from "../../../../shared/fixtures.ts";\n\ntest("the list of orders looks as it should", async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();\n    await expect(page).toHaveScreenshot({ fullPage: true });\n  });\n});\n`;
    const { outcome } = await design(replies([...write("list-orders", visual), ...valid(3).slice(2)]), { runner });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/tests/orders/listing/list-orders.spec.ts")?.verdict, "passed", messages(outcome));
    assert.ok(runner.runs.some((test) => test.content === tagged(visual)));
  });
});

describe("a model that reads images", () => {
  const screenshotParameters = (server: ScriptedServer) =>
    (server.requests[0]!.body as { tools: { function: { name: string; parameters: { properties: object } } }[] }).tools.find(
      (tool) => tool.function.name === "shop_screenshot",
    )!.function.parameters.properties;

  it("is given the screenshots of the designer when the configuration declares it, and their path alone otherwise", async () => {
    for (const vision of [true, false]) {
      const { server } = await design([{ body: answer(MODEL, "Done.") }], { vision });
      assert.equal("within" in screenshotParameters(server), vision);
    }
  });
});

describe("the packages a test may import", () => {
  it("are those the package.json of the test repository declares, and @playwright/test without one", () => {
    assert.deepEqual(
      testPackages(
        JSON.stringify({
          dependencies: { "@axe-core/playwright": "4.11.0" },
          devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" },
        }),
      ),
      ["@axe-core/playwright", "@playwright/test"],
    );
    for (const manifest of [undefined, "{ not json", "null", "{}", JSON.stringify({ dependencies: "x", devDependencies: null })])
      assert.deepEqual(testPackages(manifest), ["@playwright/test"], String(manifest));
  });

  it("let an accessibility test import axe-core when the test repository declares it, and refuse a package it does not", async () => {
    const manifest = JSON.stringify({ devDependencies: { "@playwright/test": "1.64.1", "@axe-core/playwright": "4.11.0" } });
    const a11y = spec("list-orders")
      .replace('from "../../../../shared/fixtures.ts";', 'from "../../../../shared/fixtures.ts";\nimport AxeBuilder from "@axe-core/playwright";')
      .replace("  });\n});", "    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);\n  });\n});");
    const other = spec("x").replace(
      'from "../../../../shared/fixtures.ts";',
      'from "../../../../shared/fixtures.ts";\nimport { faker } from "@faker-js/faker";',
    );
    const bare = `import { test as bare } from "@playwright/test";\n${spec("x")}`;
    const { outcome, server } = await design(replies([[run(other, "faker")], [run(bare, "bare")], ...write("list-orders", a11y), ...valid(3).slice(2)]), {
      root: repository(KNOWLEDGE_BASE, manifest),
    });
    assert.equal(outcome.tests.find((test) => test.path === "apps/shop/tests/orders/listing/list-orders.spec.ts")?.verdict, "passed", messages(outcome));
    assert.match(toolResult(server, "faker"), /Refused \(TEST-IMPORT\): Line 2 imports @faker-js\/faker; import only @axe-core\/playwright or a relative path/);
    // Playwright itself is imported through the fixtures of the repository, which the refusal names.
    assert.match(
      String(toolResult(server, "bare")),
      /Refused \(TEST-IMPORT\): Line 1 imports @playwright\/test; import test and expect from .*shared\/fixtures\.ts.*, the fixtures of the test repository\./,
    );

    assert.match(asked(server, 1), /\nA test may import: apps\/shared\/fixtures\.ts, @axe-core\/playwright\.\n/);
  });
});

describe("the references of a visual test", () => {
  it("are written and committed with the test, and listed in the state", async () => {
    const reference = {
      path: "apps/shop/tests/orders/listing/list-orders.spec.ts-snapshots/list-orders-1-shop.png",
      content: new Uint8Array([137, 80, 78, 71]),
    };
    const runner: TestRunner = {
      run: async (test) => ({
        startedAt: "2026-11-13T10:00:00.000Z",
        tests: [{ id: `shop › ${test.path} › t`, verdict: "passed", reason: "ok" }],
        ...(test.path.endsWith("list-orders.spec.ts") ? { references: [reference] } : {}),
      }),
    };
    const { outcome, root } = await design(replies(valid(3)), { runner: runner as FakeTestRunner });
    assert.ok(filesOf(root).includes(reference.path));
    assert.deepEqual([...readFileSync(join(root, reference.path))], [137, 80, 78, 71]);
    assert.deepEqual(outcome.tests.find((test) => test.path === "apps/shop/tests/orders/listing/list-orders.spec.ts")?.references, [reference.path]);
    assert.ok(outcome.tests.filter((test) => test.path !== "apps/shop/tests/orders/listing/list-orders.spec.ts").every((test) => !("references" in test)));
  });
});

describe("the files the harness writes itself", () => {
  it("do not stop a design when they are tracked and changed, as a knowledge base committed then rewritten", async () => {
    const root = repository();
    git(root, "add", "-f", ".oqas/knowledge");
    git(root, "commit", "-q", "-m", "chore: keep the knowledge base");
    const knowledgeBaseFile = join(root, ".oqas", "knowledge", "knowledge-base.json");
    writeFileSync(knowledgeBaseFile, `${readFileSync(knowledgeBaseFile, "utf8")}\n`);
    const { outcome } = await design(replies(valid(3)), { root });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(git(root, "status", "--porcelain"), /\.oqas\/knowledge\/knowledge-base\.json/);
  });
});
