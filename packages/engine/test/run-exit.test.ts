import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { AGENT_PROMPTS } from "@open-qa-stack/agents";
import { AGENT_KEYS } from "@open-qa-stack/domain";
import { answer, closedPort, KeptMemories } from "@open-qa-stack/testing";
import { liveRuntime, Run } from "../src/index.ts";
import { MODEL, workspace, configText, chain, git, idleRound, plugged, ran, repository, spec, stateOf, journalOf, untracked } from "./run-support.ts";

describe("solo command, criterion 1 — without a configuration, the command stops with 3 and touches nothing", () => {
  it("calls no model, runs nothing, and creates no file", async () => {
    const run = await ran([], { config: () => undefined });
    assert.equal(run.code, 3);
    assert.deepEqual([run.server.requests.length, run.runner.commands.length, untracked(run.root)], [0, 0, ""]);
    assert.match(run.err, /oqas\.json cannot be read/);
  });
});

describe("solo command, criterion 2 — an invalid configuration, or an environment not declared, stops with 3", () => {
  it("names the JSON path at fault, and writes nothing", async () => {
    const run = await ran([], { config: (url) => JSON.parse(JSON.stringify(configText(url))).replace('"autonomous"', '"reckless"') });
    assert.equal(run.code, 3);
    assert.match(run.err, /\/autonomy\/level/);
    assert.match(run.err, /oqas\.json is not a valid configuration: correct it\./);
    assert.deepEqual([run.server.requests.length, untracked(run.root)], [0, ""]);
  });

  it("names the variable of the environment the configuration in force names and the machine does not set", async () => {
    const root = repository(configText("http://127.0.0.1:9/v1"));
    const host = plugged(root);
    const code = await new Run({
      memory: new KeptMemories(),
      repositoryRoot: root,
      environment: "local",
      env: {},
      ...host.ports,
      openRuntime: (config) => liveRuntime(config, {}),
    }).run();
    assert.equal(code, 3);
    assert.match(host.err, /\[configuration\] error: \/knowledge\/1\/connectionStringEnv: Environment variable SHOP_DB_URL is not set\./);
  });

  it("stops on what the source of the configuration raises when it is no refusal of the configuration", async () => {
    const root = repository(configText("http://127.0.0.1:9/v1"));
    const host = plugged(root);
    const configuration = { current: () => Promise.reject(new Error("The database is unreachable.")) };
    const run = new Run({
      memory: new KeptMemories(),
      repositoryRoot: root,
      environment: "local",
      env: {},
      ...host.ports,
      configuration,
      openRuntime: (config) => liveRuntime(config, {}),
    });
    await assert.rejects(run.run(), { message: "The database is unreachable." });
  });

  it("names the environment at fault, and asks for one when several are declared", async () => {
    const unknown = await ran([], { environment: "production" });
    assert.equal(unknown.code, 3);
    assert.match(unknown.err, /The environment production is not declared; the configuration declares local, staging\./);
    const unnamed = await ran([], { config: (url) => configText(url) });
    assert.equal(unnamed.code, 3);
    assert.match(unnamed.err, /Several environments are declared \(local, staging\); name one with --environment\./);
  });

  it("refuses to write tests where an application forbids it, before anything starts, naming it and what to do", async () => {
    const forbidding = (url: string): string => {
      const config = JSON.parse(configText(url)) as { applications: { environments: { name: string; allow?: unknown }[] }[] };
      config.applications[0]!.environments.find(({ name }) => name === "local")!.allow = { design: false };
      return JSON.stringify(config);
    };
    const refused = await ran([], { environment: "local", config: forbidding });
    assert.equal(refused.code, 3);
    assert.match(
      refused.err,
      /Writing tests is not allowed on the environment local of .+: allow it in the settings of that environment, or choose another one\./,
    );
  });
});

describe("solo command, criterion 3 — a missing prerequisite stops with 4, and nothing is mapped", () => {
  it("names the folder that is no git repository, the model server that does not answer, and npm", async () => {
    const down = `http://127.0.0.1:${await closedPort()}/v1`;
    const run = await ran([], {
      environment: "local",
      modelUrl: down,
      script: { npm: 127 },
      root: (config) => {
        const root = mkdtempSync(join(workspace, "plain-"));
        writeFileSync(join(root, "oqas.json"), config!);
        return root;
      },
    });
    assert.equal(run.code, 4);
    assert.match(run.err, /is not the root of a git repository with a commit/);
    assert.match(run.err, new RegExp(`The model server at ${down.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} does not answer`));
    assert.match(run.err, /npm cannot be run/);
    assert.ok(!run.err.includes("[cartography]"));
  });
});

describe("solo command, criterion 4 — the whole chain, every test passed, exits with 0", () => {
  it("runs the six steps in order, each with its start and its end", async () => {
    const run = await ran(chain(), { environment: "local" });
    assert.equal(run.code, 0, run.err);
    const framing = journalOf(run.root)
      .filter((entry) => entry.event === "started" || entry.event === "finished")
      .map((entry) => `${entry.step}:${entry.event}`);
    assert.deepEqual(
      framing,
      ["configuration", "prerequisites", "cartography", "design", "execution", "summary"].flatMap((step) => [`${step}:started`, `${step}:finished`]),
    );
    // The default charter ends each step with a screenshot: the skeleton of each test holds it.
    assert.ok(JSON.stringify(run.server.requests.map((request) => request.body)).includes("await testInfo.attach("));
  });
});

describe("solo command, criterion 5 — a failed test exits with 1; a blocked or indeterminate one, without a failure, with 2", () => {
  it("exits with 1 when a test fails at the end, and with 2 when one is skipped", async () => {
    const failed = await ran(chain(), { environment: "local", script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "unexpected" : "expected") } });
    assert.equal(failed.code, 1, failed.err);
    const skipped = await ran(chain(), { environment: "local", script: { final: (file) => (file.endsWith("test-2.spec.ts") ? "skipped" : "expected") } });
    assert.equal(skipped.code, 2, skipped.err);
  });
});

describe("solo command, criterion 6 — an application that does not answer when the tests run blocks them, and exits with 2", () => {
  it("gives blocked to every test in the state", async () => {
    const run = await ran(chain(), { environment: "local", script: { downAfterDesign: true } });
    assert.equal(run.code, 2, run.err);
    const state = stateOf(run.root);
    assert.equal(state.designed.length, 3);
    assert.deepEqual(
      state.tests.map((test) => test.verdict),
      ["blocked", "blocked", "blocked"],
    );
  });
});

describe("solo command, criteria 7 and 8 — a limit that stops a task is journaled; without a test designed, the command stops with 5 and runs nothing", () => {
  it("names the limit reached, writes no passed, and runs no test", async () => {
    const replies = [...chain().slice(0, 5), ...Array.from({ length: 3 }, () => ({ body: answer(MODEL, "I see nothing to test.") }))];
    const config = (url: string) =>
      configText(url, {
        autonomy: { level: "bounded", task: { maxIterations: 2 } },
      });
    const run = await ran(replies, { environment: "local", config });
    assert.equal(run.code, 5, run.err);
    assert.match(run.err, /reached its iterations limit/);
    assert.equal(run.runner.finalRuns, 0);
    assert.ok(stateOf(run.root).tests.every((test) => test.verdict !== "passed"));
  });
});

describe("the tests the repository already had", () => {
  it("are run again after the new ones, but those a design set aside", async () => {
    const folder = "apps/shop/tests/orders/listing";
    const run = await ran(chain(), {
      environment: "local",
      root: (config) => {
        const root = repository(config);
        mkdirSync(join(root, folder), { recursive: true });
        writeFileSync(join(root, folder, "earlier.spec.ts"), spec("earlier"));
        writeFileSync(join(root, folder, "aside.spec.ts"), spec("aside"));
        // An earlier design kept the second unfinished, for a person to decide.
        mkdirSync(join(root, ".oqas", "designs"), { recursive: true });
        const state = { tests: [{ path: `${folder}/aside.spec.ts`, classes: [{ class: "unfinished" }] }] };
        writeFileSync(join(root, ".oqas", "designs", "design-20261101T000000Z.json"), JSON.stringify(state));
        git(root, "add", "-A");
        git(root, "commit", "-q", "-m", "test: add the tests of an earlier design");
        return root;
      },
    });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(
      stateOf(run.root).tests.map(({ id }) => /([\w-]+)\.spec\.ts/.exec(id)![1]),
      ["test-1", "test-2", "test-3", "earlier"],
    );
    assert.ok(
      journalOf(run.root).some(({ message }) => message === "1 test the repository already had is run again after them."),
      run.err,
    );
  });
});

describe("the rounds of the design of a run", () => {
  it("design the visual tests once, after the rounds that brought nothing new", async () => {
    const replies = chain();
    // The agent that plans the visual tests finds nothing to compare either.
    replies.splice(replies.length - 4, 0, ...idleRound(5));
    const run = await ran(replies, {
      environment: "local",
      config: (url) => configText(url, { design: { reviewPlan: false, reviewTests: false, reviewCode: false, levels: ["functional"], visualTests: true } }),
    });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(stateOf(run.root).batch, { rounds: [3, 0, 0, 0, 0], tests: 3, endedBy: "idle-rounds" });
    assert.ok(
      journalOf(run.root).some(({ message }) => message === "Visual tests: 0 new, 3 in the batch."),
      run.err,
    );
  });
});

describe("solo command, criterion 9 — the state of a complete run", () => {
  it("holds the run, the knowledge base, the tests and their branch, the report, a verdict per test, and the duration and requests of each step", async () => {
    // A clock that moves a second at each reading, from the instant of the run: each step takes time.
    let tick = 0;
    const now = () => new Date(Date.parse("2026-11-13T12:00:00.000Z") + 1000 * tick++);
    const run = await ran(chain(), { environment: "local", now });
    const state = stateOf(run.root);
    assert.equal(state.runId, "oqas-2026-11-13T12-00-00-000Z");
    assert.equal(state.knowledgeBase, ".oqas/knowledge/knowledge-base.json");
    assert.deepEqual([...state.designed].sort(), [
      "apps/shop/tests/orders/listing/test-1.spec.ts",
      "apps/shop/tests/orders/listing/test-2.spec.ts",
      "apps/shop/tests/orders/listing/test-3.spec.ts",
    ]);
    assert.match(state.branch!, /^oqas\/design-/);
    assert.match(state.report!, /^\.oqas\/runs\/run-.*\/report\.json$/);
    assert.ok(existsSync(join(run.root, state.run!)));
    assert.deepEqual(
      state.tests.map((test) => test.verdict),
      ["passed", "passed", "passed"],
    );
    // The state is written by the summary, which therefore is not among its steps.
    assert.deepEqual(
      state.steps.map((step) => step.step),
      ["configuration", "prerequisites", "cartography", "design", "execution"],
    );
    assert.ok(
      state.steps.find((step) => step.step === "cartography")!.modelRequests > 0 && state.steps.find((step) => step.step === "design")!.modelRequests > 0,
    );
    assert.ok(
      state.steps.every((step) => step.durationMs > 0),
      JSON.stringify(state.steps),
    );
    // Each step counts the requests of its own sessions: with the list of the models the prerequisites ask for, they are all the server received.
    // The design counts its first round, then the three rounds that brought nothing new.
    assert.deepEqual(
      state.steps.map((step) => step.modelRequests),
      [0, 0, 5, 12 + 3 * 2, 0],
    );
    assert.equal(run.server.requests.length, 1 + 5 + 12 + 3 * 2);
    assert.deepEqual(state.batch, { rounds: [3, 0, 0, 0], tests: 3, endedBy: "idle-rounds" });
    assert.ok(state.durationMs > state.steps.reduce((total, step) => total + step.durationMs, 0) - 1);
  });
});

describe("a model for each role", () => {
  it("opens one runtime for each model, sends each role to its own, and tells it in the journal", async () => {
    const run = await ran(chain(), {
      environment: "local",
      config: (url) => {
        const config = JSON.parse(configText(url)) as { model: Record<string, unknown> };
        config.model["roles"] = { cartographer: { model: "small" }, designer: { model: "big" }, reviewer: { model: "big" } };
        return JSON.stringify(config);
      },
    });
    assert.equal(run.code, 0, run.err);
    const asked = run.server.requests.flatMap(({ body }) => {
      const { model } = (body ?? {}) as { model?: string };
      return model === undefined ? [] : [model];
    });
    assert.deepEqual([...new Set(asked)], ["small", "big"]);
    const told = journalOf(run.root).map(({ message }) => message);
    for (const said of ["The cartographer works with the model small.", "The designer works with the model big.", "The reviewer works with the model big."])
      assert.ok(told.includes(said), said);
  });

  it("leaves the model of every one to a role that has none", async () => {
    const run = await ran(chain(), {
      environment: "local",
      config: (url) => {
        const config = JSON.parse(configText(url)) as { model: Record<string, unknown> };
        config.model["roles"] = { reviewer: { model: "big" } };
        return JSON.stringify(config);
      },
    });
    assert.equal(run.code, 0);
    assert.ok(!journalOf(run.root).some(({ message }) => message.includes("The designer works with")));
  });
});

describe("what the team asks of an agent", () => {
  it("ends its prompt, in the sessions of that agent alone, and is told once in the journal", async () => {
    const run = await ran(chain(), {
      environment: "local",
      config: (url) =>
        JSON.stringify({
          ...(JSON.parse(configText(url)) as object),
          agents: { writer: { instructions: " Say policy. " }, planner: { instructions: " " }, "cartography-orchestrator": { instructions: "Few domains." } },
        }),
    });
    assert.equal(run.code, 0, run.err);
    const asked = (text: string) =>
      run.server.requests.map(({ body }) => JSON.stringify(body ?? {})).filter((sent) => sent.includes(`Instructions of the team:\\n\\n${text}`));
    assert.ok(asked("Say policy.").length > 0 && asked("Say policy.").every((sent) => sent.includes("run_test")));
    assert.ok(asked("Few domains.").length > 0 && asked("Few domains.").every((sent) => sent.includes("submit_knowledge_base")));
    const told = journalOf(run.root).filter(({ message }) => message.includes("instructions of the team"));
    assert.deepEqual(
      told.map(({ step, message }) => `${step} ${message.replace(/\([0-9a-f]{12}\)/, "(digest)")}`),
      [
        "cartography The cartography-orchestrator follows the instructions of the team (digest).",
        "design The writer follows the instructions of the team (digest).",
      ],
    );
  });
});

describe("a prompt the team writes in place of that of an agent", () => {
  it("is what its sessions are given, with the values of its variables, and is told once in the journal", async () => {
    const replaced = (url: string) => {
      const config = JSON.parse(configText(url)) as object;
      const own = Object.fromEntries(AGENT_KEYS.map((agent) => [agent, { prompt: { text: AGENT_PROMPTS[agent].template, basedOn: "a".repeat(64) } }]));
      return JSON.stringify({ ...config, agents: { ...own, writer: { prompt: { text: "Team writer: call {{run_tool}}.", basedOn: "a".repeat(64) } } } });
    };
    const run = await ran(chain(), { environment: "local", config: replaced });
    assert.equal(run.code, 0, run.err);
    const sent = run.server.requests.map(({ body }) => JSON.stringify(body ?? {}));
    assert.ok(sent.some((body) => body.includes("Team writer: call run_test.")));
    assert.ok(!sent.some((body) => body.includes(AGENT_PROMPTS.writer.template.slice(0, 60))));
    const told = journalOf(run.root)
      .filter(({ message }) => message.includes("a prompt of the team"))
      .map(({ step, message }) => `${step} ${message.replace(/\([0-9a-f]{12}\)/, "(digest)")}`);
    assert.ok(told.includes("design The writer follows a prompt of the team (digest)."), told.join("\n"));
    assert.ok(told.includes("design The planner follows a prompt of the team (digest)."), told.join("\n"));
    assert.equal(new Set(told).size, told.length);
  });
});
