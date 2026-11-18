import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { chain, solo } from "./solo-run-support.ts";

describe("solo command, criterion 14 — the command imports only the engine, harness, agents, tools and domain", () => {
  it("imports no other package, and never the SDK of the agents", () => {
    const folder = new URL("../src/", import.meta.url);
    const imported = readdirSync(folder, { recursive: true })
      .filter((file) => String(file).endsWith(".ts"))
      .flatMap((file) => [...readFileSync(new URL(String(file), folder), "utf8").matchAll(/(?:from\s+|import\s*\(?\s*)"([^"]+)"/g)].map((match) => match[1]!));
    const allowed = /^(node:|\.\/|@open-qa-stack\/(engine|harness|agents|tools|domain)$)/;
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
      "@open-qa-stack/engine",
      "@open-qa-stack/harness",
      "@open-qa-stack/tools",
    ]);
  });
});

describe("the command oqas", () => {
  it("runs the whole chain from its arguments, with the system clock and the live runtime", async () => {
    const run = await solo(chain(), { environment: "local" });
    assert.equal(run.code, 0, run.err);
    assert.match(run.out, /^Run oqas-\d{4}-\d{2}-\d{2}T.*: exit code 0\./);
    // Without --follow, the error output holds the journal alone.
    assert.doesNotMatch(run.err, /^\d\d:\d\d:\d\d /m);
  });

  it("prints what the agents do while they do it, when asked to follow", async () => {
    const run = await solo(chain(), { environment: "local", follow: true });
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

describe("the brief of a run", () => {
  it("goes from the option to the designer, and to the state of the design", async () => {
    const run = await solo(chain(), { environment: "local", brief: "tester la recherche d'un client" });
    assert.equal(run.code, 0, run.err);
    assert.ok(run.server.requests.some((request) => (JSON.stringify(request.body) ?? "").includes("<brief>\\ntester la recherche d'un client\\n</brief>")));
    const designs = join(run.root, ".oqas", "designs");
    const [design] = readdirSync(designs);
    assert.equal((JSON.parse(readFileSync(join(designs, design!), "utf8")) as { brief: string }).brief, "tester la recherche d'un client");
  });
});
