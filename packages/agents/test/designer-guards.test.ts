import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { answer, toolCalls, type ScriptedServer } from "@open-qa-stack/testing";
import { moduleSyntax } from "@open-qa-stack/tools";
import type { TestCheck } from "@open-qa-stack/domain";
import {
  MODEL,
  BRANCH,
  USERNAME,
  DB_URL,
  site,
  workspace,
  git,
  INDEX,
  repository,
  snapshot,
  spec,
  tagged,
  scenario,
  OPEN,
  SEARCH,
  PLAN,
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
  specsOf,
} from "./designer-support.ts";

describe("criterion 4 — a test that imports anything but the fixtures, a declared package or a relative path is not run, and the journal names the module", () => {
  it("refuses a platform package, a computed module, a path outside the repository and another test", async () => {
    const imports = (line: string) => `${line}\n${spec("imports")}`;
    const refused = [
      run(imports(`import { Designer } from "@open-qa-stack/agents";`), "platform"),
      run(imports(`const helper = await import(process.env.HELPER!);`), "computed"),
      run(imports(`import { secret } from "../../../../../../outside.ts";`), "outside"),
      run(imports(`import "./test-1.spec.ts";`), "chained"),
    ];
    const helped = imports(`import { openOrders } from "./helpers/orders.ts";`);
    const runner = new FakeTestRunner();
    const { outcome, root, server } = await design(replies([refused, ...write("list-orders", helped), ...valid(3).slice(2)]), { runner });
    const journal = messages(outcome);
    assert.match(
      journal,
      /\[TEST-IMPORT\] The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not be run: Line 1 imports @open-qa-stack\/agents; import only a relative path inside the test repository\./,
    );
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports a module whose name is computed/);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports (\.\.\/){6}outside\.ts, outside the test repository\./);
    assert.match(journal, /\[TEST-IMPORT\] .*: Line 1 imports \.\/test-1\.spec\.ts, another test file/);
    assert.match(told(server, "platform"), /^Refused \(TEST-IMPORT\): Line 1 imports @open-qa-stack\/agents; .*\nNothing else was refused\.$/);
    assert.deepEqual([runner.runs.length, runner.runs[0]!.content], [3, tagged(helped)]);
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "utf8"), tagged(helped));
  });
});

describe("criterion 5 — a test that does not parse as TypeScript is not run, and the journal holds the parse error", () => {
  it("refuses it with the line and column of the error", async () => {
    const { outcome } = await design(
      replies([[run(`import { test } from "../../../../shared/fixtures.ts";\ntest("x", async () => {\n`, "parse")], ...valid(3)]),
    );
    assert.match(
      messages(outcome),
      /\[TEST-SYNTAX\] The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not be run: The test does not parse as TypeScript: line \d+, column \d+: (missing|unexpected) /,
    );
    assert.equal(outcome.ok, true);
  });
});

describe("criterion 6 — a test that holds a declared address or the value of an account variable is not run", () => {
  it("refuses an address, a host and a connection string, masks its value in the journal, and lets a test hold the credentials of a test account", async () => {
    const runner = new FakeTestRunner();
    const { outcome, server } = await design(
      replies([
        [
          run(spec("x").replace(`"/orders"`, `"${site.origin}/orders"`), "address"),
          run(spec("x").replace(`"/orders"`, `"//ledger.test:8100/orders"`), "host"),
          run(spec("x").replace(`"/orders"`, `"/orders?db=${encodeURIComponent(DB_URL)}"`), "login"),
          run(`const base = "${DB_URL}";\ntest("x", async () => {\n`, "leaky"),
        ],
        [run(broken("list-orders"), "failing")],
        [close("leaked", { cause: "application", evidence: `It reads ${DB_URL}.` })],
        [look("again")],
        ...valid(3),
      ]),
      { runner },
    );
    const journal = messages(outcome);
    assert.match(journal, new RegExp(`\\[TEST-ADDRESS\\] .*: The test holds ${site.origin.replaceAll(".", "\\.")}, an address of the configuration`));
    assert.match(journal, /\[TEST-ADDRESS\] .*: The test holds ledger\.test:8100, an address of the configuration/);
    assert.match(journal, /\[TEST-SECRET\] .*: The proposal holds the value of SHOP_DB_URL; read it with process\.env\.SHOP_DB_URL instead\./);
    assert.match(
      toolResult(server, "leaked"),
      /Refused \(PROPOSE-SECRET\): the diagnosis holds the value of SHOP_DB_URL\. Leave it out; a test reads it with process\.env\.SHOP_DB_URL\./,
    );
    // A text that holds a secret is refused for it before it is read: nothing of it is quoted.
    assert.doesNotMatch(journal, /TEST-SYNTAX/);
    assert.equal(runner.runs.length, 4);
    const told = server.requests.flatMap((request) =>
      (request.body as { messages: { role: string; content: unknown }[] }).messages.filter((message) => message.role === "tool"),
    );
    const traces = [journal, JSON.stringify(told)].join("\n");
    assert.ok(!traces.includes(DB_URL) && !traces.includes(encodeURIComponent(DB_URL)));
  });

  it("checks only the variables the environment sets", async () => {
    const { outcome } = await design(replies(valid(3)), { env: { SHOP_USERNAME: USERNAME, SHOP_PASSWORD: "" } });
    assert.equal(outcome.ok, true);
  });
});

/** The branch of an earlier design a design goes on with. */
const EARLIER = "oqas/design-earlier";

describe("criterion 7 — a dirty working tree or a taken branch stops the design before anything is written", () => {
  it("stops on a changed tracked file, an untracked file outside the state and the index, and a taken branch, and changes nothing", async () => {
    const root = repository();
    git(root, "branch", BRANCH);
    writeFileSync(join(root, "specs", "orders.md"), "# Orders, changed\n");
    writeFileSync(join(root, "notes.txt"), "draft\n");
    mkdirSync(join(root, ".oqas", "memory"), { recursive: true });
    writeFileSync(join(root, ".oqas", "memory", "notes.jsonl"), "");
    const { outcome, server, before } = await design(replies(valid(3)), { root });
    assert.equal(outcome.ok, false);
    assert.deepEqual(
      outcome.journal.map((entry) => entry.message),
      [
        `The branch ${BRANCH} already exists.`,
        "Tracked files are changed: specs/orders.md.",
        "Untracked files are outside the folders of the state and the index: notes.txt.",
        "No branch was created and no file was written.",
      ],
    );
    assert.deepEqual(snapshot(root), before);
    assert.equal(server.requests.length, 0);
  });

  it("refuses a folder that is not the root of a git repository, and a branch name git refuses", async () => {
    const outside = await design(replies(valid(3)), { root: join(repository(), "specs"), branch: BRANCH });
    assert.match(messages(outside.outcome), /specs is not the root of a git repository with a commit\./);
    const plain = await design(replies(valid(3)), { root: mkdtempSync(join(workspace, "plain-")) });
    assert.match(messages(plain.outcome), /plain-\w+ is not the root of a git repository with a commit\./);
    const root = repository();
    const invalid = await design(replies(valid(3)), { root, branch: "oqas/..bad" });
    assert.match(messages(invalid.outcome), /oqas\/\.\.bad is not a valid branch name\./);
    assert.deepEqual(snapshot(root), invalid.before);
  });

  it("goes on with the branch of an earlier design, checked out or not: its tests are committed on it, and no branch is created", async () => {
    for (const checkedOut of [true, false]) {
      const root = repository();
      git(root, checkedOut ? "switch" : "branch", ...(checkedOut ? ["--create", EARLIER] : [EARLIER]));
      const { outcome } = await design(replies(valid(3)), { root, continued: EARLIER });
      assert.equal(outcome.branch, EARLIER);
      assert.equal(git(root, "branch", "--show-current"), EARLIER);
      assert.ok(filesOf(root, EARLIER).includes("apps/shop/tests/orders/listing/list-orders.spec.ts"), messages(outcome));
      assert.equal(git(root, "branch", "--list", BRANCH), "");
    }
  });

  it("refuses to go on with a branch that does not exist, and changes nothing", async () => {
    const root = repository();
    const { outcome, server, before } = await design(replies(valid(3)), { root, continued: "oqas/gone" });
    assert.deepEqual(
      outcome.journal.map((entry) => entry.message),
      ["The branch oqas/gone does not exist: there is nothing to go on with.", "No branch was created and no file was written."],
    );
    assert.deepEqual(snapshot(root), before);
    assert.equal(server.requests.length, 0);
  });

  it("creates the branch when the only untracked files are the index and the state", async () => {
    const root = repository();
    assert.match(git(root, "status", "--porcelain", "--untracked-files=all"), /^\?\? \.oqas\/index\/domain-index\.json/);
    const { outcome } = await design(replies(valid(3)), { root });
    assert.equal(outcome.branch, BRANCH);
  });
});

describe("criterion 8 — the references of the remote are the same before and after the design, whatever its outcome", () => {
  it("contacts no remote when the design succeeds, fails, or stops before the session", async () => {
    for (const turns of [valid(3), valid(1)]) {
      const { root, before } = await design(replies(turns));
      assert.equal(snapshot(root).remote, before.remote);
    }
    const root = repository();
    git(root, "branch", BRANCH);
    const stopped = await design(replies(valid(3)), { root });
    assert.equal(snapshot(root).remote, stopped.before.remote);
  });
});

describe("criterion 9 — past the action limit the task is cut, the journal says so, and the scenario under way is not written", () => {
  it("writes the test closed before the cut, not the one run after the 201st action", async () => {
    const actions = Array.from({ length: 201 }, (_, i) => ({ id: `g${i}`, name: "shop_goto", arguments: { url: "/" } }));
    const { outcome, root } = await design([
      ...valid(1).map((calls) => ({ body: toolCalls(MODEL, calls) })),
      { body: toolCalls(MODEL, [...actions, run(spec("place-order"), "late")]) },
      { body: answer(MODEL, "Done.") },
    ]);
    assert.match(messages(outcome), /The task reached its actions limit; no test was written for the scenario under way\./);
    assert.deepEqual(specsOf(root), ["apps/shop/tests/orders/listing/list-orders.spec.ts"]);
    assert.match(messages(outcome), /The design failed: 1 test was obtained, 3 are expected, one per scenario of the plan\./);
  });
});

describe("criterion 10 — no generated test imports another, and nothing is written in the journeys or the blocks", () => {
  it("holds for three and two tests", async () => {
    for (const count of [3, 2]) {
      const { root } = await design(replies(valid(count)));
      const files = filesOf(root);
      assert.deepEqual(
        files.filter((path) => path.startsWith("parcours/") || path.includes("/blocs/")),
        [],
      );
      for (const path of files.filter((file) => file.endsWith(".spec.ts"))) {
        const syntax = await moduleSyntax(readFileSync(join(root, path), "utf8"));
        assert.ok(syntax.ok);
        assert.deepEqual(
          syntax.imports.map((imported) => imported.module),
          ["../../../../shared/fixtures.ts"],
        );
      }
    }
  });
});

describe("criterion 11 — the designer imports neither the SDK nor a package its package may not depend on", () => {
  it("imports only node modules, its own files and @open-qa-stack/domain and tools", () => {
    const folder = new URL("../src/", import.meta.url);
    const files = readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"));
    const imported = files.flatMap((file) =>
      [...readFileSync(new URL(file, folder), "utf8").matchAll(/^(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["'];$|^import\s*["']([^"']+)["'];$/gm)].map(
        (match) => (match[1] ?? match[2])!,
      ),
    );
    const allowed = (module: string) =>
      module.startsWith("node:") || module.startsWith(".") || ["@open-qa-stack/domain", "@open-qa-stack/tools"].includes(module);
    assert.ok(files.some((file) => file.startsWith("designer")));
    assert.deepEqual(
      imported.filter((module) => !allowed(module)),
      [],
    );
  });
});

describe("guiding the designer", () => {
  it("refuses a test the check finds fault with, each finding with its line, its rule or code, and the example of its rule", async () => {
    const check: TestCheck = {
      check: async (proposed) =>
        proposed.content.includes("waits")
          ? [
              {
                kind: "charter",
                rule: "PW-WAIT-01",
                line: 4,
                column: 9,
                message: "Wait for a state, never for a fixed time.",
                example: 'await expect(page.getByRole("table")).toBeVisible();',
              },
              { kind: "charter", rule: "TEAM-TAG-01", line: 1, column: 1, message: "Tag the test." },
              { kind: "compiler", code: "TS2304", line: 2, column: 1, message: "Cannot find name 'testInfo'." },
            ]
          : [],
    };
    const { outcome, server } = await design(replies([[run(spec("waits"), "waits")], ...valid(3)]), { check });
    assert.equal(
      told(server, "waits"),
      [
        'Refused (TEST-CHECK): Line 4, column 9 (rule PW-WAIT-01): Wait for a state, never for a fixed time. Example: await expect(page.getByRole("table")).toBeVisible();',
        "Refused (TEST-CHECK): Line 1, column 1 (rule TEAM-TAG-01): Tag the test.",
        "Refused (TEST-CHECK): Line 2, column 1 (compiler TS2304): Cannot find name 'testInfo'.",
        "Nothing else was refused.",
      ].join("\n"),
    );
    assert.match(
      messages(outcome),
      /\[TEST-CHECK\] The test apps\/shop\/tests\/orders\/listing\/list-orders\.spec\.ts could not be run: Line 1, column 1 \(rule TEAM-TAG-01\): Tag the test\./,
    );
    assert.equal(outcome.tests.length, 3);
  });

  it("names the test of a scenario after it, with a number when a file of the repository already has that path", async () => {
    const root = repository();
    mkdirSync(join(root, "apps", "shop", "tests", "orders", "listing"), { recursive: true });
    writeFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "// kept\n");
    writeFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders-2.spec.ts"), "// kept\n");
    git(root, "add", "-A", "apps");
    git(root, "commit", "-q", "-m", "test: keep a test");
    const { outcome, server } = await design(replies(valid(3)), { root });
    assert.deepEqual(
      outcome.tests.map((test) => test.path),
      [
        "apps/shop/tests/orders/listing/list-orders-3.spec.ts",
        "apps/shop/tests/orders/listing/place-order.spec.ts",
        "apps/shop/tests/orders/listing/follow-order.spec.ts",
      ],
    );
    assert.equal(readFileSync(join(root, "apps", "shop", "tests", "orders", "listing", "list-orders.spec.ts"), "utf8"), "// kept\n");
    assert.match(asked(server, 1), /\nFile: apps\/shop\/tests\/orders\/listing\/list-orders-3\.spec\.ts\n/);
    // The repository had no fixtures of its own: those written are committed with the tests.
    assert.ok(filesOf(root).includes("apps/shared/fixtures.ts"));
  });

  it("designs nothing without a readable index that matches its schema", async () => {
    for (const [index, reason] of [
      ["{", /cannot be read\./],
      [{ ...INDEX, domains: [] }, /does not match its schema: \/domains must NOT have fewer than 1 items\.$/],
    ] as const) {
      const { outcome, server } = await design(replies(valid(3)), { root: repository(index) });
      assert.match(messages(outcome), new RegExp(`^No test was designed: the domain index .*domain-index\\.json ${reason.source}`));
      assert.equal(server.requests.length, 0);
    }
  });
});

describe("the sheet of a scenario", () => {
  it("is what the agent is told once the plan is accepted, and once a scenario is closed: the scenario, its data, its file and its skeleton", async () => {
    const searched = scenario("list-orders", "other", {
      case: "negative",
      data: [
        { value: "Ada", from: "shop" },
        { value: "zzqx", from: "made-up" },
      ],
    });
    const plan = { ...PLAN, arguments: { scenarios: [searched, scenario("place-order"), scenario("follow-order")] } };
    const { server } = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [SEARCH]) }, { body: toolCalls(MODEL, [plan]) }, ...replies([DONE, ...valid(1)])],
      { plan: false },
    );
    // The session that plans is told its plan is accepted, and that it is over; the sheet goes to the session of the scenario.
    assert.match(told(server, "plan"), /^The plan is not closed yet\. It holds 3 scenarios: list-orders, place-order, follow-order\.\n/);
    const sheet = asked(server, 1);
    assert.ok(
      sheet.startsWith(
        'Write the test of this scenario for the environment local.\n\nSign-in: with the account demo; the lines of the sheet that sign in read it from process.env: keep them as they are.\nA test may import: apps/shared/fixtures.ts.\n\nScenario 1 of 3: list-orders — The list-orders scenario (functional level, other, negative, reads data), application shop.\nIntent: Verifies list-orders.\nData: "Ada" (shop); "zzqx" (made-up).\nCited: shop: /orders.\nFile: apps/shop/tests/orders/listing/list-orders.spec.ts\n\nimport { expect, test } from "../../../../shared/fixtures.ts";\n\ntest("The list-orders scenario", { tag: ["@level-functional","@domain-orders","@feature-listing","@app-shop","@kind-other","@case-negative","@data-read"] }, async ({ page }) => {\n  await test.step("1. Open the orders", async () => {\n    await page.goto("/orders");\n    // Expect 1.1: The orders show.\n    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();\n  });\n});\n',
      ),
      sheet,
    );
    assert.ok(
      sheet.endsWith("Next: check the skeleton of list-orders against its steps, complete what a comment asks, then call run_test with the whole file."),
    );
    assert.equal(told(server, "c-list-orders"), `Scenario list-orders closed: passed.\n${OVER}`);
    assert.match(
      asked(server, 2),
      /\n\nScenario 2 of 3: place-order — .*\nIntent: .*\nData: "place-order" \(made-up\)\.\nCited: .*\nFile: apps\/shop\/tests\/orders\/listing\/place-order\.spec\.ts/,
    );
  });

  it("runs as it is once the agent typed on the screen the invented value it expects: it holds the lines the browser tools returned, and the value in its field", async () => {
    const invented = scenario("list-orders", "other", {
      data: [{ value: "zzqx", from: "made-up" }],
      steps: [{ action: "Search zzqx", actions: [1, 2], expects: [{ result: "The search is echoed", shows: ["Orders", "zzqx"], absent: [] }] }],
    });
    const plan = { ...PLAN, arguments: { scenarios: [invented, scenario("place-order"), scenario("follow-order")] } };
    const sheetOf = (server: ScriptedServer) => asked(server, 1).slice(asked(server, 1).indexOf("import "), asked(server, 1).lastIndexOf("\nNext:"));
    const first = await design([{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [plan]) }, { body: answer(MODEL, "Done.") }], { plan: false });
    assert.match(
      told(first.server, "plan"),
      /Refused \(PLAN-SHOWN\): scenario list-orders, expect 1\.1, names "zzqx", a value of its data that no field of shop held in this session\. Type it with shop_fill/,
    );
    const typed = { id: "type", name: "shop_fill", arguments: { target: { role: "textbox", name: "Search orders" }, value: "zzqx" } };
    const second = await design(
      [{ body: toolCalls(MODEL, [OPEN]) }, { body: toolCalls(MODEL, [typed]) }, { body: toolCalls(MODEL, [plan]) }, { body: answer(MODEL, "Done.") }],
      { plan: false },
    );
    const skeletonText = sheetOf(second.server);
    // The field is typed in through the page object of its screen, which the harness wrote from the plan.
    const line = 'await shop.orders.searchOrdersTextbox.fill("zzqx");';
    assert.ok(
      skeletonText.includes(
        [
          '  await test.step("1. Search zzqx", async () => {',
          '    await page.goto("/orders");',
          `    ${line}`,
          "    // Expect 1.1: The search is echoed.",
          '    await expect(page.getByRole("heading", { name: "Orders", exact: true })).toBeVisible();',
          '    await expect(page.getByRole("textbox", { name: "Search orders", exact: true })).toHaveValue("zzqx");',
          "  });",
        ].join("\n"),
      ),
      skeletonText,
    );
    // A step emptied of its lines is told them again; the skeleton as it is runs.
    const idle = skeletonText.replace('    await page.goto("/orders");\n', "").replace(`    ${line}\n`, "");
    const { server } = await design(
      [
        { body: toolCalls(MODEL, [OPEN]) },
        { body: toolCalls(MODEL, [typed]) },
        { body: toolCalls(MODEL, [plan]) },
        ...replies([DONE, [run(idle, "idle")], [run(skeletonText, "whole")]]),
      ],
      { plan: false },
    );
    assert.ok(
      told(server, "idle").startsWith(
        'Refused (TEST-ACTION): step 1 does nothing: it must do "Search zzqx" with the code lines of its skeleton, before its assertions, starting with await page.goto("/orders");\n',
      ),
      told(server, "idle"),
    );
    assert.match(told(server, "whole"), /^Run of the file: passed\./);
  });
});
