import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { AgentRuntime, TaskLimits } from "@open-qa-stack/domain";
import { answer, closedPort, scriptedServer } from "@open-qa-stack/testing";
import { liveRuntime, soloCommand, SoloRun } from "../src/index.ts";
import { MODEL, WITNESS, siteUrl, configText, repository, FakeRunner, ended, written, chain, solo, stateOf, journalOf } from "./solo-run-support.ts";

describe("the edges of a run", () => {
  it("takes the folder it runs in as the test repository, and the only environment declared", async () => {
    const server = await scriptedServer([]);
    const single = configText(server.baseUrl, {
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
    const root = repository(single);
    let err = "";
    try {
      const code = await soloCommand([], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: { write: (text) => (err += text) },
        runner: new FakeRunner(root, { npm: 127 }),
      });
      assert.equal(code, 4);
      assert.match(err, /the run targets the environment local\./);
    } finally {
      await server.close();
    }
  });

  it("names the whole document for an error of syntax, and checks npm with the machine's runner by default", async () => {
    const broken = await solo([], { config: () => "{" });
    assert.equal(broken.code, 3);
    assert.match(broken.err, /\[configuration\] error: \/: /);
    const down = `http://127.0.0.1:${await closedPort()}/v1`;
    const root = repository(configText(down));
    let err = "";
    const code = await new SoloRun({
      repositoryRoot: root,
      environment: "local",
      env: { SHOP_DB_URL: WITNESS },
      write: (line) => (err += line),
      print: () => undefined,
      openRuntime: (config) => liveRuntime(config, {}),
    }).run();
    assert.equal(code, 4);
    assert.ok(!err.includes("npm cannot be run"), err);
  });

  it("runs the tests an incomplete design gave, and does not end as passed", async () => {
    // The session of the third scenario ends without a call, whatever it is reminded of: its test is left unfinished.
    const replies = [...chain().slice(0, 9), ...written("test-1"), ...written("test-2"), ...Array.from({ length: 8 }, () => ended)];
    const run = await solo(replies, { environment: "local" });
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

  it("stops with 5 on an unexpected error in a step, closes the step, and keeps what the steps before produced", async () => {
    const run = await solo(chain(), { environment: "local", script: { installCrash: true } });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /\[design\] error: The design stopped on an unexpected error: spawn npm EACCES/);
    assert.match(run.err, /\[design\] finished: The design did not succeed\./);
    const state = stateOf(run.root);
    assert.deepEqual([state.exitCode, state.index, state.steps.at(-1)?.step], [5, ".oqas/index/domain-index.json", "design"]);
  });

  it("counts the requests of a step that throws once its sessions ran", async () => {
    // A hook that refuses every commit: the designer throws when it commits the tests it wrote.
    const run = await solo(chain(), {
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
    let err = "";
    try {
      const code = await new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: () => Promise.reject("no runtime"),
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      }).run();
      assert.equal(code, 5);
      assert.match(err, /\[cartography\] error: The cartography stopped on an unexpected error: no runtime/);
      assert.equal(stateOf(root).exitCode, 5);
    } finally {
      await server.close();
    }
  });

  it("journals a runtime that cannot be closed, and writes the state all the same", async () => {
    const server = await scriptedServer(chain());
    const root = repository(configText(server.baseUrl));
    let err = "";
    try {
      const code = await new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: async (config) => {
          const open = await liveRuntime(config, {});
          return { runtime: open.runtime, close: () => open.close().then(() => Promise.reject(new Error("the gateway hangs"))) };
        },
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      }).run();
      assert.equal(code, 0, err);
      assert.match(err, /\[summary\] error: The runtime of the agents could not be closed: the gateway hangs/);
      assert.equal(stateOf(root).exitCode, 0);
    } finally {
      await server.close();
    }
  });

  it("journals a state that cannot be written, and throws", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    // A folder where the state goes: the state cannot be written there.
    mkdirSync(join(root, ".oqas", "runs", "oqas-2026-11-13T12-00-00-000Z.json"), { recursive: true });
    let err = "";
    try {
      const run = new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
        openRuntime: () => Promise.reject(new Error("no runtime")),
        runner: new FakeRunner(root),
        now: () => new Date("2026-11-13T12:00:00.000Z"),
      });
      await assert.rejects(run.run(), /EISDIR/);
      assert.match(err, /\[summary\] error: The summary stopped on an unexpected error: EISDIR/);
      assert.match(journalOf(root).at(-1)!.message, /The summary did not succeed\./);
    } finally {
      await server.close();
    }
  });

  it("exits with 5 when its error output closes, and says why on it as long as it can", async () => {
    const server = await scriptedServer([]);
    const root = repository(configText(server.baseUrl));
    let err = "";
    try {
      // The lines of the summary are refused: the summary cannot even tell why it stopped.
      const code = await soloCommand(["--environment", "local"], {
        env: { SHOP_DB_URL: WITNESS },
        cwd: root,
        stdout: { write: () => true },
        stderr: {
          write: (text) => {
            if (text.startsWith("[summary]")) throw new Error("the output is closed");
            err += text;
            return true;
          },
        },
        runner: new FakeRunner(root),
        connect: () => Promise.reject(new Error("no runtime")),
      });
      assert.equal(code, 5);
      assert.match(err, /oqas stopped on an unexpected error: the output is closed/);
    } finally {
      await server.close();
    }
  });

  it("stops with 5 when no index is written, and designs nothing", async () => {
    const replies = [{ body: { data: [] } }, ...Array.from({ length: 6 }, () => ({ body: answer(MODEL, "Nothing to say.") }))];
    const run = await solo(replies, { environment: "local" });
    assert.equal(run.code, 5);
    assert.match(run.err, /No index was written/);
    assert.ok(!run.err.includes("[design]"));
    assert.equal(stateOf(run.root).index, undefined);
    // The requests of a cartography that wrote no index are counted all the same.
    assert.ok(stateOf(run.root).steps.find((step) => step.step === "cartography")!.modelRequests > 0);
  });
});

describe("the guardrail of a run", () => {
  /** A run whose clock reads its start, then `after` every time once more; with the limits of each session its agents opened. */
  async function guarded(autonomy: unknown, after: string) {
    const server = await scriptedServer(chain());
    const root = repository(configText(server.baseUrl, { autonomy }));
    const limits: (TaskLimits | undefined)[] = [];
    let err = "";
    let read = false;
    try {
      const code = await new SoloRun({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        write: (line) => (err += line),
        print: () => undefined,
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
      return { code, err, limits, root };
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

  it("bounds no session by the clock when the level sets no guardrail", async () => {
    const run = await guarded({ level: "bounded", task: { maxIterations: 100 } }, "2026-11-13T14:00:00.000Z");
    assert.equal(run.code, 0, run.err);
    assert.ok(run.limits.every((limits) => limits?.maxDurationMs === null));
  });
});
