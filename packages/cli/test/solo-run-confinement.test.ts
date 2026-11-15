import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { toolCalls } from "@open-qa-stack/testing";
import { MODEL, WITNESS, siteUrl, git, configText, repository, submit, IDS, scenario, planned, chain, solo, stateOf } from "./solo-run-support.ts";

describe("solo command, criteria 10 and 11 — nothing is pushed, the git configuration stays, and an uncommitted change is kept", () => {
  it("leaves the remote and the git configuration as they were after a complete run", async () => {
    let before = { remote: "", config: "" };
    const run = await solo(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        before = { remote: git(git(root, "remote", "get-url", "origin"), "for-each-ref"), config: git(root, "config", "--list", "--local") };
        return root;
      },
    });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(
      { remote: git(git(run.root, "remote", "get-url", "origin"), "for-each-ref"), config: git(run.root, "config", "--list", "--local") },
      before,
    );
  });

  it("finds an uncommitted change again, unchanged", async () => {
    const run = await solo(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        writeFileSync(join(root, "specs", "orders.md"), "# Orders\n\nAn edit under way.\n");
        return root;
      },
    });
    assert.equal(run.code, 5);
    assert.equal(readFileSync(join(run.root, "specs", "orders.md"), "utf8"), "# Orders\n\nAn edit under way.\n");
  });
});

describe("solo command, criterion 12 — the value of the connection string appears nowhere", () => {
  it("is in neither the journal, the state, nor the outputs", async () => {
    const run = await solo(chain(), { environment: "local" });
    for (const trace of [
      run.err,
      run.out,
      readFileSync(join(run.root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.jsonl"), "utf8"),
      JSON.stringify(stateOf(run.root)),
    ])
      assert.ok(!trace.includes("w1tness-pass"));
  });

  it("is masked in the reason of a verdict", async () => {
    const run = await solo(chain(), {
      environment: "local",
      script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "unexpected" : "expected"), finalError: `Error: cannot reach ${WITNESS}` },
    });
    assert.equal(run.code, 1, run.err);
    const failed = stateOf(run.root).tests.find((test) => test.verdict === "failed")!;
    assert.match(failed.reason, /cannot reach \[secret\]/);
    assert.ok(!run.err.includes("w1tness-pass"));
  });

  it("is masked when an output of the machine holds it", async () => {
    const run = await solo(chain(), { environment: "local", script: { install: 1, installError: `npm error cannot reach ${WITNESS}\n` } });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /npm error cannot reach \[secret\]/);
    for (const trace of [
      run.err,
      run.out,
      readFileSync(join(run.root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.jsonl"), "utf8"),
      JSON.stringify(stateOf(run.root)),
    ])
      assert.ok(!trace.includes("w1tness-pass"));
  });
});

describe("solo command, criterion 13 — the harness reaches only what the configuration declares", () => {
  it("calls the model server and the declared address, and nothing else", async () => {
    // The guard of the suite refuses any address outside this machine; here, the destinations are the scripted model and the site.
    const run = await solo(chain(), { environment: "local" });
    assert.ok(run.server.requests.length > 0);
    assert.ok(
      run.runner.commands.filter((command) => command.command[1] === "-e").every((command) => command.command.slice(4).every((url) => url === siteUrl)),
    );
  });
});

describe("solo command, criterion 14 — the command imports only shared, harness, agents, tools and domain", () => {
  it("imports no other package, and never the SDK of the agents", () => {
    const folder = new URL("../src/", import.meta.url);
    const imported = readdirSync(folder, { recursive: true })
      .filter((file) => String(file).endsWith(".ts"))
      .flatMap((file) => [...readFileSync(new URL(String(file), folder), "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)"([^"]+)"/g)].map((match) => match[1]!));
    const allowed = /^(node:|\.\/|@open-qa-stack\/(shared|harness|agents|tools|domain)$)/;
    assert.ok(imported.length > 0);
    assert.deepEqual(
      imported.filter((module) => !allowed.test(module)),
      [],
    );
    assert.ok(!imported.some((module) => module.includes("copilot")));
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { dependencies: Record<string, string> };
    assert.deepEqual(Object.keys(manifest.dependencies).sort(), [
      "@open-qa-stack/agents",
      "@open-qa-stack/domain",
      "@open-qa-stack/harness",
      "@open-qa-stack/shared",
      "@open-qa-stack/tools",
    ]);
  });
});

describe("solo command, criterion 15 — no test opens a model nor installs anything", () => {
  it("answers every command of npm and Playwright with the double", async () => {
    const run = await solo(chain(), { environment: "local" });
    // The design and the execution share one installation.
    assert.equal(run.runner.commands.filter((command) => command.command[0] === "npm" && command.command[1] === "ci").length, 1);
    assert.ok(run.runner.commands.every((command) => ["npm", "node", "node_modules/.bin/playwright"].includes(command.command[0]!)));
  });
});

describe("solo command, the charter and the dependencies", () => {
  it("stops with 3, before the model, on a charter that disables an unknown rule", async () => {
    const run = await solo([], { environment: "local", config: (url) => configText(url, { charter: { disable: [{ rule: "PW-NOPE-01", reason: "No." }] } }) });
    assert.equal(run.code, 3);
    assert.match(run.err, /\/charter\/disable\/0\/rule/);
    assert.equal(run.server.requests.length, 0);
  });

  it("stops with 5 before designing when the dependencies of the test repository cannot be installed", async () => {
    const run = await solo(chain(), { environment: "local", script: { install: 1 } });
    assert.equal(run.code, 5);
    assert.match(run.err, /\[design\] error: The dependencies could not be installed: npm error 404 Not Found/);
    assert.ok(!run.err.includes("propose"));
  });
});

describe("the command oqas", () => {
  it("runs the whole chain from its arguments, with the system clock and the live runtime", async () => {
    const run = await solo(chain(), { environment: "local", command: true });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^Run oqas-\d{4}-\d{2}-\d{2}T.*: exit code 0\./);
    // Without --follow, the error output holds the journal alone.
    assert.doesNotMatch(run.err, /^\d\d:\d\d:\d\d /m);
  });

  it("prints what the agents do while they do it, when asked to follow", async () => {
    const run = await solo(chain(), { environment: "local", command: true, follow: true });
    assert.equal(run.code, 0, run.err);
    // Each call of a tool with its result, each message of the harness, and what each phase asked of the model.
    assert.match(run.err, /^\d\d:\d\d:\d\d plan -> propose_plan\(/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d plan <- The plan is not closed yet\. It holds 3 scenarios: test-1, test-2, test-3\./m);
    assert.match(run.err, /^\d\d:\d\d:\d\d write harness: Write the test of this scenario/m);
    assert.match(run.err, /^\d\d:\d\d:\d\d plan \d+ model requests/m);
    // The journal is still printed, and an entry of the journal is printed once.
    assert.equal(run.err.split("\n").filter((line) => line.includes("The plan was accepted:")).length, 1);
  });
});

describe("what the brief asks and the plan leaves out", () => {
  it("is printed in the summary and kept in the state of the run, and neither for a plan that covers the brief", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No operation of the shop cancels one." }];
    const partial = submit("propose_plan", { scenarios: IDS.map(scenario), uncovered }, "plan");
    const replies = chain().map((reply) => (reply.body === planned.body ? { body: toolCalls(MODEL, [partial]) } : reply));
    const run = await solo(replies, { environment: "local", command: true });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /\nNot covered: Cancel an order\. No operation of the shop cancels one\.\nState: /);
    const [state] = readdirSync(join(run.root, ".oqas", "runs")).filter((file) => file.endsWith(".json"));
    assert.deepEqual((JSON.parse(readFileSync(join(run.root, ".oqas", "runs", state!), "utf8")) as { uncovered?: unknown }).uncovered, uncovered);
    const whole = await solo(chain(), { environment: "local", command: true });
    assert.doesNotMatch(whole.out, /Not covered/);
    const [covered] = readdirSync(join(whole.root, ".oqas", "runs")).filter((file) => file.endsWith(".json"));
    assert.equal("uncovered" in (JSON.parse(readFileSync(join(whole.root, ".oqas", "runs", covered!), "utf8")) as object), false);
  });
});

describe("a brief no test can do", () => {
  it("runs nothing, says what is not covered, and exits with 2: nothing was verified", async () => {
    const uncovered = [{ asked: "Cancel an order.", reason: "No operation of the shop cancels one." }];
    const none = submit("propose_plan", { scenarios: [], uncovered }, "plan");
    const replies = chain().map((reply) => (reply.body === planned.body ? { body: toolCalls(MODEL, [none]) } : reply));
    const run = await solo(replies, { environment: "local", command: true });
    assert.equal(run.code, 2, run.err);
    assert.match(run.err, /\[design\] No test is run: the design gave none\./);
    assert.doesNotMatch(run.err, /\[execution\]/);
    assert.match(run.out, /\nNot covered: Cancel an order\. No operation of the shop cancels one\.\nState: /);
    assert.equal(run.runner.finalRuns, 0);
  });
});

describe("the brief of a run", () => {
  it("goes from the option to the designer, and to the state of the design", async () => {
    const run = await solo(chain(), { environment: "local", command: true, brief: "tester la recherche d'un client" });
    assert.equal(run.code, 0, run.err);
    assert.ok(run.server.requests.some((request) => (JSON.stringify(request.body) ?? "").includes("<brief>\\ntester la recherche d'un client\\n</brief>")));
    const designs = join(run.root, ".oqas", "designs");
    const [design] = readdirSync(designs);
    assert.equal((JSON.parse(readFileSync(join(designs, design!), "utf8")) as { brief: string }).brief, "tester la recherche d'un client");
  });
});
