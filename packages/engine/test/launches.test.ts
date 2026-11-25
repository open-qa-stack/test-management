import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME, InvalidConfigurationError, LaunchRefusedError, launchProgress, type EndedLaunch } from "@open-qa-stack/domain";
import { chain } from "@open-qa-stack/testing/test-repository";
import { afterEach, describe, it } from "vitest";
import { KeptMemories } from "@open-qa-stack/testing";
import { Configuration, NoRepositoryError, Sessions } from "../src/index.ts";
import { MemoryDomainSettingStore } from "./support/memory-domain-setting-store.ts";
import { eventually } from "./support/eventually.ts";
import { designDoor, ENV, Hosted } from "./support/hosted.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryDocumentStore } from "./support/memory-document-store.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";
import { MemorySessionStore } from "./support/memory-session-store.ts";
import { RecordingLogger } from "./support/recording-logger.ts";

/** A file of tests of the repository, as a launch names it. */
const SEARCH = "apps/shop/tests/search.spec.ts";

let hosted: Hosted;
afterEach(() => hosted.close());

/** The test repository of the host, with a file of tests in it. */
function withTests(root: string): void {
  mkdirSync(join(root, "apps/shop/tests"), { recursive: true });
  writeFileSync(join(root, SEARCH), 'import { test } from "@playwright/test";\n\ntest("the test", async () => {});\n');
}

/** Waits until the launch under way ended, and gives how. */
function lastLaunch(sessions: Sessions): Promise<EndedLaunch> {
  return eventually(async () => {
    const { running, last } = await sessions.launches();
    assert.ok(running === undefined && last !== undefined);
    return last;
  });
}

describe("tests launched as they are, with no agent", () => {
  it("run the files named in the environment the configuration declares, and keep their execution as a manual one", async () => {
    const seen: (readonly string[])[] = [];
    hosted = await Hosted.create([], { before: (step) => void seen.push(step.command) });
    withTests(hosted.root);
    assert.deepEqual(await hosted.sessions.launches(), {});
    const launch = await hosted.sessions.launch({ paths: [SEARCH], environment: "local" });
    assert.deepEqual({ ...launch, startedAt: "" }, { startedAt: "", environment: "local", paths: [SEARCH] });
    assert.deepEqual(await hosted.sessions.launches(), { running: launch });
    const ended = await lastLaunch(hosted.sessions);
    const { items } = await hosted.executions.page({ limit: 10 });
    assert.equal(items.length, 1);
    const [execution] = items;
    assert.deepEqual(ended, { ...launch, endedAt: ended.endedAt, execution: execution!.id });
    assert.deepEqual([execution!.origin, execution!.environment], ["manual", "local"]);
    assert.equal(execution!.sessionId, undefined);
    assert.deepEqual(
      execution!.results.map(({ title, verdict }) => [title, verdict]),
      [["the test", "passed"]],
    );
    assert.deepEqual(hosted.logger.lines, [], "a launch that kept its execution says nothing");
    assert.ok(
      seen.some((command) => command.includes("--retries=1")),
      "a test that fails is run once more",
    );
  });

  it("tell how far they went while they run: how many tests, then each one the runner finished", async () => {
    let progress = "";
    const door = designDoor();
    // The run is held once the runner started, after it wrote that it runs one test, and before it finished it.
    hosted = await Hosted.create([], {
      before: async (step) => {
        const file = step.env?.["OQAS_PROGRESS_FILE"];
        if (file === undefined || step.command.includes("--list")) return;
        progress = file;
        writeFileSync(file, `${JSON.stringify({ total: 1 })}\n`);
        await door.hold({ command: ["npm", "ci"] });
      },
    });
    withTests(hosted.root);
    const launch = await hosted.sessions.launch({ paths: [SEARCH], environment: "local" });
    assert.deepEqual(await hosted.sessions.launches(), { running: launch }, "nothing is told before the runner started");
    await door.reached;
    assert.match(progress, /\/\.oqas\/launches\/launch-[\d-]+T[\d-]+Z\/progress\.jsonl$/);
    assert.deepEqual(await hosted.sessions.launches(), { running: { ...launch, progress: { total: 1, finished: [] } } });
    door.open();
    await lastLaunch(hosted.sessions);
    assert.deepEqual(launchProgress(readFileSync(progress, "utf8")), { total: 1, finished: [{ path: SEARCH, title: "the test", verdict: "passed" }] });
  });

  it("take the turn of the sessions: refused while a session runs, and a session opened while they run waits until they ended", async () => {
    const door = designDoor();
    hosted = await Hosted.create(chain(), { before: door.hold });
    withTests(hosted.root);
    const opened = await hosted.sessions.open({ request: "Test the orders.", environment: "local" });
    await door.reached;
    await assert.rejects(hosted.sessions.launch({}), (error) => error instanceof LaunchRefusedError && /A session runs its tests/.test(error.message));
    door.open();
    await hosted.ended(opened.id);

    const held = designDoor();
    const again = await Hosted.create([], { before: held.hold });
    try {
      withTests(again.root);
      await again.sessions.launch({ paths: [SEARCH], environment: "local" });
      await held.reached;
      await assert.rejects(again.sessions.launch({}), (error) => error instanceof LaunchRefusedError && /launched already run/.test(error.message));
      const waiting = await again.sessions.open({ request: "Test the orders.", environment: "nowhere" });
      assert.equal(waiting.state, "queued");
      held.open();
      await lastLaunch(again.sessions);
      assert.equal((await again.ended(waiting.id)).state, "interrupted");
    } finally {
      await again.close();
    }
  });

  it("are refused at once when the environment is not declared, when the configuration is not valid, or when the host has no test repository", async () => {
    hosted = await Hosted.create([]);
    await assert.rejects(
      hosted.sessions.launch({ environment: "nowhere" }),
      (error) => error instanceof LaunchRefusedError && error.message === "The environment nowhere is not declared: the configuration declares local, staging.",
    );
    await assert.rejects(
      hosted.sessions.launch({}),
      (error) =>
        error instanceof LaunchRefusedError && error.message === "Several environments are declared (local, staging): name the one the tests run against.",
    );
    // An environment where an application forbids running tests refuses a launch before it starts.
    const file = join(hosted.root, CONFIG_FILE_NAME);
    const config = JSON.parse(readFileSync(file, "utf8")) as { applications: { environments: { name: string; allow?: unknown }[] }[] };
    config.applications[0]!.environments.find(({ name }) => name === "local")!.allow = { run: false };
    writeFileSync(file, JSON.stringify(config));
    await hosted.settings.synchronise();
    await assert.rejects(
      hosted.sessions.launch({ environment: "local" }),
      (error) => error instanceof LaunchRefusedError && error.message.startsWith("Running tests is not allowed on the environment local of "),
    );
    const unset = await Hosted.create([], { host: { env: {} } });
    try {
      await assert.rejects(unset.sessions.launch({ environment: "local" }), (error) => error instanceof InvalidConfigurationError);
    } finally {
      await unset.close();
    }
    const none = new Sessions({
      memory: new KeptMemories(),
      domainSettings: new MemoryDomainSettingStore(),
      store: new MemorySessionStore(),
      configuration: new Configuration(new MemoryConfigurationStore(), undefined),
      documents: new MemoryDocumentStore(),
      executions: new MemoryExecutionStore(),
      repository: undefined,
      env: ENV,
      logger: new RecordingLogger(),
      takesOver: false,
    });
    await assert.rejects(none.launch({}), (error) => error instanceof NoRepositoryError);
    assert.deepEqual(await hosted.sessions.launches(), {});
  });

  it("end with no execution, and say why, when the tests could not run: nothing to install them with, an environment that does not answer, a store that refuses", async () => {
    hosted = await Hosted.create([]);
    rmSync(join(hosted.root, "package-lock.json"), { force: true });
    // A configuration of one environment: the launch need not name it.
    const config = JSON.parse(readFileSync(join(hosted.root, CONFIG_FILE_NAME), "utf8")) as {
      applications: { environments: { name: string }[] }[];
      knowledge: { attachments: { environment: string }[] }[];
    };
    for (const application of config.applications) application.environments = application.environments.filter(({ name }) => name === "local");
    config.knowledge = config.knowledge.filter(({ attachments }) => attachments.every(({ environment }) => environment === "local"));
    writeFileSync(join(hosted.root, CONFIG_FILE_NAME), JSON.stringify(config));
    // With no runner of its own, the host runs the commands in the test repository: none runs without a lockfile.
    const logger = new RecordingLogger();
    const local = new Sessions({
      memory: new KeptMemories(),
      domainSettings: new MemoryDomainSettingStore(),
      store: new MemorySessionStore(),
      configuration: new Configuration(new MemoryConfigurationStore(), hosted.root),
      documents: new MemoryDocumentStore(),
      executions: new MemoryExecutionStore(),
      repository: hosted.root,
      env: ENV,
      logger,
      takesOver: false,
    });
    const launch = await local.launch({});
    assert.equal(launch.environment, "local");
    const unprepared = await lastLaunch(local);
    assert.deepEqual(unprepared, {
      ...launch,
      endedAt: unprepared.endedAt,
      failure: "package-lock.json is missing, cannot be read, or does not install @playwright/test.",
    });
    assert.match(logger.lines.join("\n"), /^warn The tests launched at .* kept no execution: package-lock\.json is missing/);

    const silent = await Hosted.create([]);
    try {
      withTests(silent.root);
      await silent.sessions.launch({ paths: [SEARCH], environment: "staging" });
      assert.match(String((await lastLaunch(silent.sessions)).failure), /http:\/\/127\.0\.0\.1:1/);
      await silent.sessions.launch({ environment: "staging" });
      assert.equal((await lastLaunch(silent.sessions)).failure, "The runner wrote no report.");
      assert.deepEqual((await silent.executions.page({ limit: 10 })).items, []);
    } finally {
      await silent.close();
    }

    const store = new MemoryExecutionStore();
    const refusing = await Hosted.create([], { host: { executions: store } });
    try {
      withTests(refusing.root);
      store.refusal = new Error("The store is full.");
      await refusing.sessions.launch({ paths: [SEARCH], environment: "local" });
      assert.equal((await lastLaunch(refusing.sessions)).failure, "The store is full.");
      store.refusal = "full";
      await refusing.sessions.launch({ paths: [SEARCH], environment: "local" });
      assert.equal((await lastLaunch(refusing.sessions)).failure, "full");
    } finally {
      await refusing.close();
    }
  });

  it("are waited for when the host stops, which refuses any other", async () => {
    const door = designDoor();
    hosted = await Hosted.create([], { before: door.hold });
    withTests(hosted.root);
    await hosted.sessions.launch({ paths: [SEARCH], environment: "local" });
    await door.reached;
    const stopped = hosted.sessions.stop(60_000);
    await assert.rejects(hosted.sessions.launch({}), (error) => error instanceof LaunchRefusedError);
    door.open();
    assert.equal(await stopped, true);
    assert.equal((await lastLaunch(hosted.sessions)).execution !== undefined, true);
    await assert.rejects(
      hosted.sessions.launch({ environment: "local" }),
      (error) => error instanceof LaunchRefusedError && /The instance stops/.test(error.message),
    );
  });
});
