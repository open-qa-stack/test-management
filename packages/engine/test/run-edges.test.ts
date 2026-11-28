import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { AgentRuntime, TaskLimits, TraceLine } from "@open-qa-stack/domain";
import { answer, closedPort, scriptedServer, toolCalls, KeptMemories } from "@open-qa-stack/testing";
import { liveRuntime, Run } from "../src/index.ts";
import {
  MODEL,
  WITNESS,
  siteUrl,
  configText,
  repository,
  FakeRunner,
  ended,
  written,
  chain,
  later,
  plugged,
  ran,
  stateOf,
  journalOf,
  submit,
} from "./run-support.ts";

describe("the edges of a run", () => {
  it("names the whole document for an error of syntax, and checks npm with the machine's runner by default", async () => {
    const broken = await ran([], { config: () => "{" });
    assert.equal(broken.code, 3);
    assert.match(broken.err, /\[configuration\] error: \/: /);
    const down = `http://127.0.0.1:${await closedPort()}/v1`;
    const root = repository(configText(down));
    const host = plugged(root);
    const code = await new Run({
      memory: new KeptMemories(),
      repositoryRoot: root,
      environment: "local",
      env: { SHOP_DB_URL: WITNESS },
      ...host.ports,
      openRuntime: (config) => liveRuntime(config, {}),
    }).run();
    assert.equal(code, 4);
    assert.ok(!host.err.includes("npm cannot be run"), host.err);
  });

  it("takes the only environment declared, keeps the card of a source that did not change, and shows who follows each line of the trace", async () => {
    const single = (url: string) =>
      configText(url, {
        applications: [
          {
            id: "shop",
            name: "Shop",
            type: "api",
            authentication: { method: "none" },
            environments: [{ name: "local", apis: [{ name: "backend", baseUrl: siteUrl }] }],
          },
        ],
        knowledge: [{ id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] }],
      });
    // The dependencies cannot be installed: each run stops once its cartography is over.
    const script = { install: 1 };
    const followed: TraceLine[] = [];
    const first = await ran(chain(), { config: single, script, follow: (line) => followed.push(line) });
    assert.match(first.err, /the run targets the environment local\./);
    assert.match(first.err, /\[cartography\] finished: The cartography succeeded\./);
    // Each run has a model of its own, which the configuration of the repository names.
    const again = (config: string | undefined) => {
      writeFileSync(join(first.root, "oqas.json"), config!);
      return first.root;
    };
    const kept = await ran(chain(), { root: again, config: single, script, now: later(13) });
    assert.match(kept.err, /The card of order-specs is up to date; it was kept\./);
    assert.ok(followed.some((line) => line.phase === "consolidation" && line.event.type === "tool-call"));
  });

  it("runs the tests an incomplete design gave, and does not end as passed", async () => {
    // The session of the third scenario ends without a call, whatever it is reminded of: its test is left unfinished.
    const replies = [...chain().slice(0, 9), ...written("test-1"), ...written("test-2"), ...Array.from({ length: 8 }, () => ended)];
    const run = await ran(replies, { environment: "local" });
    assert.equal(run.code, 2, run.err);
    assert.match(run.err, /\[design\] error: The design failed: 2 tests were obtained, 3 are expected, one per scenario of the plan\./);
    assert.match(run.err, /\[design\] The design is incomplete: the tests it gave are run, and the run cannot end as passed\./);
    assert.match(
      run.err,
      /\[execution\] 2 of the 3 tests designed are run; left out as unfinished, duplicate or unfeasible: apps\/shop\/tests\/orders\/listing\/test-3\.spec\.ts\./,
    );
    assert.deepEqual(
      stateOf(run.root).tests!.map((test) => test.verdict),
      ["passed", "passed"],
    );
  });

  it("puts back the test a run stopped during its trial left in the repository, says so, and designs from the repository as it was", async () => {
    const stray = "apps/shop/tests/orders/listing/stray.spec.ts";
    const run = await ran(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        // As a process ended during a trial leaves it: the test at its path, and the mark of the trial.
        mkdirSync(join(root, "apps/shop/tests/orders/listing"), { recursive: true });
        writeFileSync(join(root, stray), "test under trial");
        mkdirSync(join(root, ".oqas/trials"), { recursive: true });
        writeFileSync(join(root, ".oqas/trials/open.json"), JSON.stringify({ path: stray, snapshots: false }));
        return root;
      },
    });
    assert.equal(run.code, 0, run.err);
    assert.match(
      run.err,
      /\[design\] apps\/shop\/tests\/orders\/listing\/stray\.spec\.ts was under trial when a run was stopped: it was put back as the repository had it, and its scenario is written again\./,
    );
    assert.equal(existsSync(join(run.root, stray)), false);
  });

  it("repairs once the tests that passed alone and failed in the suite, then runs the suite again", async () => {
    // The test of test-2 fails at the first run of the suite, as after tests that changed its data, and passes after its repair.
    let calls = 0;
    const final = (file: string) => (file.endsWith("test-2.spec.ts") && ++calls === 1 ? "unexpected" : "expected");
    const coupled = "apps/shop/tests/orders/listing/test-2.spec.ts";
    const repairing = [{ body: toolCalls(MODEL, [submit("repair_tests", { paths: [coupled] }, "fix")]) }, ended, ended];
    // The rounds of the batch end on spare answers: the repair comes in their place.
    const run = await ran([...chain().slice(0, -4), ...repairing, ...chain().slice(-4)], { environment: "local", script: { final } });
    assert.equal(run.code, 0, run.err);
    assert.match(
      run.err,
      /\[execution\] 1 of the 3 tests designed passed alone and failed in the suite, depending on data other tests change: they are repaired, then the suite runs again: apps\/shop\/tests\/orders\/listing\/test-2\.spec\.ts\./,
    );
    assert.match(run.err, /\[execution\] The tests to repair: apps\/shop\/tests\/orders\/listing\/test-2\.spec\.ts\./);
    assert.match(run.err, /\[execution\] 1 of the 1 tests repaired pass in the suite now\./);
    assert.equal(run.runner.finalRuns, 2);
  });

  it("stops with 5 on an unexpected error in a step, closes the step, and keeps what the steps before produced", async () => {
    const run = await ran(chain(), { environment: "local", script: { installCrash: true } });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /\[design\] error: The design stopped on an unexpected error: spawn npm EACCES/);
    assert.match(run.err, /\[design\] finished: The design did not succeed\./);
    const state = stateOf(run.root);
    assert.deepEqual([state.exitCode, state.knowledgeBase, state.steps.at(-1)?.step], [5, ".oqas/knowledge/knowledge-base.json", "design"]);
  });

  it("counts the requests of a step that throws once its sessions ran", async () => {
    // A hook that refuses every commit: the designer throws when it commits the tests it wrote.
    const run = await ran(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        writeFileSync(join(root, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
        return root;
      },
    });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /\[design\] error: The design stopped on an unexpected error/);
    assert.equal(stateOf(run.root).steps.find((step) => step.step === "design")!.modelRequests, 12);
  });

  it("stops with 5 when the runtime of the agents cannot be opened, and still writes the state", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    const host = plugged(root);
    try {
      const code = await new Run({
        memory: new KeptMemories(),
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        ...host.ports,
        openRuntime: () => Promise.reject("no runtime"),
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      }).run();
      assert.equal(code, 5);
      assert.match(host.err, /\[cartography\] error: The cartography stopped on an unexpected error: no runtime/);
      assert.equal(stateOf(root).exitCode, 5);
    } finally {
      await server.close();
    }
  });

  it("journals a runtime that cannot be closed, and writes the state all the same", async () => {
    const server = await scriptedServer(chain());
    const root = repository(configText(server.baseUrl));
    const host = plugged(root);
    try {
      const code = await new Run({
        memory: new KeptMemories(),
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        ...host.ports,
        openRuntime: async (config) => {
          const open = await liveRuntime(config, {});
          return { runtime: open.runtime, close: () => open.close().then(() => Promise.reject(new Error("the gateway hangs"))) };
        },
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      }).run();
      assert.equal(code, 0, host.err);
      assert.match(host.err, /\[summary\] error: The runtime of the agents could not be closed: the gateway hangs/);
      assert.equal(stateOf(root).exitCode, 0);
    } finally {
      await server.close();
    }
  });

  it("journals a state that cannot be written, and throws", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    const host = plugged(root);
    try {
      const run = new Run({
        memory: new KeptMemories(),
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        ...host.ports,
        // A store that keeps nothing: the state cannot be written.
        store: { ...host.ports.store, write: () => Promise.reject(new Error("the store is closed")) },
        openRuntime: () => Promise.reject(new Error("no runtime")),
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      });
      await assert.rejects(run.run(), /the store is closed/);
      assert.match(host.err, /\[summary\] error: The summary stopped on an unexpected error: the store is closed/);
      assert.match(journalOf(root).at(-1)!.message, /The summary did not succeed\./);
    } finally {
      await server.close();
    }
  });

  it("stops with 5 when no knowledge base is written, and designs nothing", async () => {
    const replies = [{ body: { data: [] } }, ...Array.from({ length: 6 }, () => ({ body: answer(MODEL, "Nothing to say.") }))];
    const run = await ran(replies, { environment: "local" });
    assert.equal(run.code, 5);
    assert.match(run.err, /No knowledge base was written/);
    assert.ok(!run.err.includes("[design]"));
    assert.equal(stateOf(run.root).knowledgeBase, undefined);
    // The requests of a cartography that wrote no knowledge base are counted all the same.
    assert.ok(stateOf(run.root).steps.find((step) => step.step === "cartography")!.modelRequests > 0);
  });
});

describe("the guardrail of a run", () => {
  /** A run whose clock reads its start, then `after` every time once more; with the limits of each session its agents opened. */
  async function guarded(autonomy: unknown, after: string) {
    const server = await scriptedServer(chain());
    const root = repository(configText(server.baseUrl, { autonomy }));
    const limits: (TaskLimits | undefined)[] = [];
    const host = plugged(root);
    let read = false;
    try {
      const code = await new Run({
        memory: new KeptMemories(),
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        ...host.ports,
        openRuntime: async (config) => {
          const open = await liveRuntime(config, {});
          const runtime: AgentRuntime = {
            openSession: (options) => {
              limits.push(options.limits);
              return open.runtime.openSession(options);
            },
            close: () => open.runtime.close(),
          };
          return { runtime, close: () => open.close() };
        },
        runner: new FakeRunner(root),
        now: () => {
          const at = new Date(read ? after : "2026-11-13T12:00:00.000Z");
          read = true;
          return at;
        },
      }).run();
      return { code, err: host.err, limits, root };
    } finally {
      await server.close();
    }
  }

  it("gives every session the time left until the guardrail, counted from the start of the run", async () => {
    const run = await guarded({ level: "autonomous", guardrailMinutes: 1 }, "2026-11-13T12:00:20.000Z");
    assert.equal(run.code, 0, run.err);
    assert.ok(run.limits.length > 0);
    assert.ok(run.limits.every((limits) => limits?.maxDurationMs === 40_000));
  });

  it("stops a task opened once the guardrail is reached, by its duration limit", async () => {
    const run = await guarded({ level: "autonomous", guardrailMinutes: 1 }, "2026-11-13T12:01:00.000Z");
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /The session that maps order-specs reached its duration limit\./);
    assert.equal(run.limits[0]?.maxDurationMs, 0);
    assert.deepEqual(stateOf(run.root).stoppedBy, { step: "cartography", limit: "duration" });
  });
});
