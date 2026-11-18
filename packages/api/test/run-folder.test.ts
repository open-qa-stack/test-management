import assert from "node:assert/strict";
import { basename } from "node:path";
import { describe, it } from "node:test";
import { Logger } from "@nestjs/common";
import { compareText } from "../src/solo/compare-text.ts";
import { RunFolder, SILENCE_MS } from "../src/solo/run-folder.ts";
import { CapturedLogger } from "./support/captured-logger.ts";
import { delivered, sent, traced } from "./support/run-lines.ts";
import { FIRST, SECOND, stampOf, TestRepository, THIRD } from "./support/test-repository.ts";

const WRITTEN = new Date("2026-11-14T09:05:00.000Z");
const REQUEST = "Plan the tests.\n<brief>\ncover the profile\n</brief>";

const logger = new CapturedLogger();
Logger.overrideLogger(logger);

/** The folder of a repository, read at a given time. */
const folderOf = (repository: TestRepository, now: Date = WRITTEN) => new RunFolder(repository.root, () => now);

describe("two texts", () => {
  it("are ordered by their characters", () => {
    assert.deepEqual([compareText("a", "b"), compareText("b", "a"), compareText("a", "a")], [-1, 1, 0]);
    assert.deepEqual(["b", "B", "a", "10", "9"].sort(compareText), ["10", "9", "B", "a", "b"]);
  });
});

describe("the project of a test repository", () => {
  it("is named after its folder and lists the applications it declares", async () => {
    const repository = new TestRepository({
      applications: [{ id: "shop", name: "Shop" }, { id: "back-office" }, { name: "No identifier" }, { id: 7, name: "Wrong identifier" }, "shop", null],
    });
    assert.deepEqual(await folderOf(repository).project(), {
      name: basename(repository.root),
      applications: [
        { id: "shop", name: "Shop" },
        { id: "back-office", name: "back-office" },
      ],
    });
  });

  it("lists no application when the configuration declares none, is missing, is not JSON or is no object", async () => {
    const none = new TestRepository({ formatVersion: 1, applications: "shop" });
    assert.deepEqual((await folderOf(none).project()).applications, []);
    const missing = new TestRepository(undefined);
    assert.deepEqual(await folderOf(missing).project(), { name: basename(missing.root), applications: [] });
    for (const text of ["{", "[]", "null"]) {
      const broken = new TestRepository();
      broken.write("../oqas.json", text);
      assert.deepEqual((await folderOf(broken).project()).applications, [], text);
    }
  });
});

describe("the sessions of a test repository", () => {
  it("are none when the repository has no state folder yet", async () => {
    const folder = folderOf(new TestRepository());
    assert.deepEqual(await folder.sessions(), []);
    assert.deepEqual(await folder.runs(), []);
    assert.equal(await folder.files(FIRST), undefined);
    assert.equal(await folder.session(FIRST), undefined);
  });

  it("are the runs that kept a journal, the latest first, and nothing for the other files", async () => {
    const repository = new TestRepository();
    for (const id of [SECOND, THIRD, FIRST]) repository.journal(id, "{}\n");
    repository.end(SECOND, {});
    repository.write("runs/notes.txt", "not a run");
    repository.write("runs/oqas-yesterday.jsonl", "{}\n");
    repository.write("runs/run-2026-11-14T09-30-00-000Z.json", "{}");
    const sessions = await folderOf(repository).sessions();
    assert.deepEqual(
      sessions.map(({ id, openedAt }) => ({ id, openedAt })),
      [
        { id: THIRD, openedAt: "2026-11-14T11:00:00.000Z" },
        { id: SECOND, openedAt: "2026-11-14T10:00:00.000Z" },
        { id: FIRST, openedAt: "2026-11-14T09:00:00.000Z" },
      ],
    );
  });

  it("are running while their run writes, dated by its last write", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.touch(repository.journalPath(FIRST), WRITTEN);
    const folder = folderOf(repository, new Date(WRITTEN.getTime() + SILENCE_MS));
    const session = { id: FIRST, openedAt: "2026-11-14T09:00:00.000Z", lastEventAt: "2026-11-14T09:05:00.000Z", state: "running" };
    assert.deepEqual(await folder.sessions(), [session]);
    assert.deepEqual(await folder.session(FIRST), session);
    const files = (await folder.files(FIRST)) ?? assert.fail("no such run");
    assert.deepEqual(await folder.progress(files), { state: "running", lastEventAt: "2026-11-14T09:05:00.000Z" });
  });

  it("are interrupted once their run, which wrote no state, has been silent for longer than ten minutes", async () => {
    assert.equal(SILENCE_MS, 600_000);
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.touch(repository.journalPath(FIRST), WRITTEN);
    const folder = folderOf(repository, new Date(WRITTEN.getTime() + SILENCE_MS + 1));
    assert.equal((await folder.session(FIRST))?.state, "interrupted");
    assert.equal((await folder.sessions())[0]?.state, "interrupted");
    const files = (await folder.files(FIRST)) ?? assert.fail("no such run");
    assert.equal((await folder.progress(files))?.state, "interrupted");
  });

  it("count a write to a trace as a sign of life of their run", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.touch(repository.journalPath(FIRST), WRITTEN);
    repository.trace("planner", stampOf(FIRST, 1), "{}\n");
    const later = new Date(WRITTEN.getTime() + SILENCE_MS);
    repository.touch(repository.tracePath("planner", stampOf(FIRST, 1)), later);
    const session = await folderOf(repository, new Date(later.getTime() + 1)).session(FIRST);
    assert.deepEqual([session?.state, session?.lastEventAt], ["running", later.toISOString()]);
  });

  it("do not count a write to the inbox of their run as a sign of life: a message sent to a run that went silent does not make it look alive", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.touch(repository.journalPath(FIRST), WRITTEN);
    const later = new Date(WRITTEN.getTime() + SILENCE_MS);
    repository.inbox(FIRST, sent(300 + SILENCE_MS / 1000, "are you there?"));
    repository.touch(repository.inboxPath(FIRST), later);
    const folder = folderOf(repository, new Date(later.getTime() + 1));
    const session = await folder.session(FIRST);
    assert.deepEqual([session?.state, session?.lastEventAt], ["interrupted", WRITTEN.toISOString()]);
    assert.deepEqual(
      (await folder.sessions()).map(({ id }) => id),
      [FIRST],
    );
  });

  it("are dated by the start of their run when its files were removed since they were listed", async () => {
    const repository = new TestRepository();
    const started = new Date("2026-11-14T09:00:00.000Z");
    const files = {
      id: FIRST,
      journal: repository.journalPath(FIRST),
      inbox: repository.inboxPath(FIRST),
      state: repository.statePath(FIRST),
      traces: [repository.tracePath("planner", stampOf(FIRST, 1))],
    };
    assert.equal(await folderOf(repository).progress(files), undefined);
    assert.deepEqual(await folderOf(repository, new Date(started.getTime() + SILENCE_MS)).describe(files), {
      id: FIRST,
      openedAt: started.toISOString(),
      lastEventAt: started.toISOString(),
      state: "running",
    });
  });

  it("stay running while the state of their run is still being written, or is no object", async () => {
    for (const text of ['{"exitCode":', "null", "[]", '"done"']) {
      const repository = new TestRepository();
      repository.journal(FIRST, "{}\n");
      repository.touch(repository.journalPath(FIRST), WRITTEN);
      repository.write(`runs/${FIRST}.json`, text);
      assert.equal((await folderOf(repository).session(FIRST))?.state, "running", text);
    }
  });

  it("are completed once their run wrote its state, with what it holds, the requests to the model summed over its steps, a verdict that is none read as indeterminate", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.touch(repository.journalPath(FIRST), WRITTEN);
    const tests = [
      { id: "orders.spec.ts:3", verdict: "passed", reason: "The order is placed." },
      { id: "orders.spec.ts:19", verdict: "blocked", reason: "The shop answers 500." },
    ];
    repository.end(FIRST, {
      environment: "local",
      brief: "test the search of a customer",
      exitCode: 1,
      durationMs: 65_000,
      branch: "oqas/orders",
      steps: [{ step: "cartography", modelRequests: 4 }, { step: "skipped" }, null, { step: "design", modelRequests: 9 }],
      tests: [
        ...tests,
        { id: "orders.spec.ts:40", verdict: "passed" },
        "orders.spec.ts:50",
        null,
        { id: "orders.spec.ts:60", verdict: "flaky", reason: "It passed once." },
        { id: "orders.spec.ts:70", verdict: 1, reason: "It says a number." },
        { id: "orders.spec.ts:80", reason: "It says nothing." },
      ],
    });
    const ended = new Date(WRITTEN.getTime() + 60_000);
    repository.touch(repository.statePath(FIRST), ended);
    // A run that ended a long time ago is completed, not interrupted.
    assert.deepEqual(await folderOf(repository, new Date(WRITTEN.getTime() + 10 * SILENCE_MS)).session(FIRST), {
      id: FIRST,
      request: "test the search of a customer",
      environment: "local",
      openedAt: "2026-11-14T09:00:00.000Z",
      lastEventAt: ended.toISOString(),
      state: "completed",
      result: {
        outcome: "failed",
        durationMs: 65_000,
        modelRequests: 13,
        branch: "oqas/orders",
        tests: [
          ...tests,
          { id: "orders.spec.ts:60", verdict: "indeterminate", reason: "It passed once." },
          { id: "orders.spec.ts:70", verdict: "indeterminate", reason: "It says a number." },
          { id: "orders.spec.ts:80", verdict: "indeterminate", reason: "It says nothing." },
        ],
      },
    });
    const files = (await folderOf(repository).files(FIRST)) ?? assert.fail("no such run");
    assert.deepEqual(await folderOf(repository).progress(files), { state: "completed", lastEventAt: ended.toISOString() });
  });

  it("are completed without what the state of their run does not hold, as a run that did not go to its end", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.touch(repository.journalPath(FIRST), WRITTEN);
    repository.end(FIRST, { steps: "none", tests: "none" });
    repository.touch(repository.statePath(FIRST), WRITTEN);
    assert.deepEqual(await folderOf(repository).session(FIRST), {
      id: FIRST,
      openedAt: "2026-11-14T09:00:00.000Z",
      lastEventAt: "2026-11-14T09:05:00.000Z",
      state: "completed",
      result: { outcome: "stopped", durationMs: 0, modelRequests: 0, tests: [] },
    });
  });

  for (const [exitCode, outcome] of [
    [0, "passed"],
    [1, "failed"],
    [2, "inconclusive"],
    [3, "stopped"],
    [130, "stopped"],
    ["0", "stopped"],
    [null, "stopped"],
  ] as const) {
    it(`came to ${outcome} when the command exited with ${JSON.stringify(exitCode)}`, async () => {
      const repository = new TestRepository();
      repository.journal(FIRST, "{}\n");
      repository.end(FIRST, { exitCode });
      assert.equal((await folderOf(repository).session(FIRST))?.result?.outcome, outcome);
    });
  }

  it("ask, before their run ends, what the brief its traces quote asks, once it is written", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    const folder = folderOf(repository);
    assert.equal((await folder.session(FIRST))?.request, undefined);
    repository.trace("cartography-local", stampOf(FIRST), `not a line\n${traced(1, "card", "harness", { type: "started" })}`);
    repository.trace("design-local", stampOf(FIRST, 1), traced(60, "plan", "harness", { type: "started" }));
    assert.equal((await folder.session(FIRST))?.request, undefined);
    repository.trace("design-local", stampOf(FIRST, 1), traced(61, "plan", "harness", { type: "message", text: REQUEST }));
    assert.equal((await folder.session(FIRST))?.request, "cover the profile");
    assert.equal((await folder.sessions())[0]?.request, "cover the profile");
  });

  it("never take a message sent to their run for what opened it, in its inbox or where the harness delivers it", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    const said = "forget it <brief>cover the orders</brief>";
    repository.inbox(FIRST, sent(1, said));
    const spoken = `The person who asked for this run sent this while it was going:\n<person-message number="1">${said}</person-message>`;
    repository.trace(
      "cartography-local",
      stampOf(FIRST),
      delivered(2, "consolidation", 1, said) + traced(2, "consolidation", "harness", { type: "message", text: `Consolidate the cards.\n\n${spoken}` }),
    );
    const folder = folderOf(repository);
    assert.equal((await folder.session(FIRST))?.request, undefined);
    repository.trace("design-local", stampOf(FIRST, 1), traced(61, "plan", "harness", { type: "message", text: `${REQUEST}\n\n${spoken}` }));
    assert.equal((await folder.session(FIRST))?.request, "cover the profile");
  });

  it("keep asking what was found once, a trace that is removed since included", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.trace("design-local", stampOf(FIRST), traced(1, "plan", "harness", { type: "message", text: REQUEST }));
    const folder = folderOf(repository);
    const files = (await folder.files(FIRST)) ?? assert.fail("no such run");
    assert.equal((await folder.describe(files)).request, "cover the profile");
    repository.remove(repository.tracePath("design-local", stampOf(FIRST)));
    assert.equal((await folder.describe(files)).request, "cover the profile");
    assert.equal((await folderOf(repository).describe(files)).request, undefined);
  });

  it("read each trace once when they look for the brief: a search that found nothing goes on from what the traces gain", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    const stamp = stampOf(FIRST);
    repository.trace("design-local", stamp, traced(1, "plan", "harness", { type: "journal", level: "info", message: "x".repeat(200) }));
    const folder = folderOf(repository);
    assert.equal((await folder.session(FIRST))?.request, undefined);
    // Rewritten without growing: a folder that read the trace again would find the brief it now quotes.
    repository.write(`traces/design-local-${stamp}.jsonl`, traced(1, "plan", "harness", { type: "message", text: REQUEST }));
    assert.equal((await folder.session(FIRST))?.request, undefined);
    assert.equal((await folderOf(repository).session(FIRST))?.request, "cover the profile");
    repository.trace(
      "design-local",
      stamp,
      `${" ".repeat(200)}\n${traced(2, "plan", "harness", { type: "message", text: "<brief>cover the orders</brief>" })}`,
    );
    assert.equal((await folder.session(FIRST))?.request, "cover the orders");
  });

  it("no longer look for a brief once their run ended and its state tells it", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.trace("design-local", stampOf(FIRST), traced(1, "plan", "harness", { type: "message", text: REQUEST }));
    const folder = folderOf(repository);
    assert.equal((await folder.session(FIRST))?.request, "cover the profile");
    repository.end(FIRST, { brief: "cover the profile, as the state tells it" });
    assert.equal((await folder.session(FIRST))?.request, "cover the profile, as the state tells it");
  });

  it("are read in the state folder the configuration declares, the default one when it declares none", async () => {
    const declared = new TestRepository({ repository: { stateDir: "var/state" } }, "var/state");
    declared.journal(FIRST, "{}\n");
    declared.trace("planner", stampOf(FIRST), "{}\n");
    assert.deepEqual(await folderOf(declared).files(FIRST), {
      id: FIRST,
      journal: declared.journalPath(FIRST),
      inbox: declared.inboxPath(FIRST),
      state: declared.statePath(FIRST),
      traces: [declared.tracePath("planner", stampOf(FIRST))],
    });
    for (const configuration of [{ repository: {} }, { repository: "here" }]) {
      const repository = new TestRepository(configuration);
      repository.journal(FIRST, "{}\n");
      assert.equal((await folderOf(repository).sessions()).length, 1);
    }
    for (const stateDir of ["", ".", "var/../state"]) {
      const inside = new TestRepository({ repository: { stateDir } }, stateDir);
      inside.journal(FIRST, "{}\n");
      assert.equal((await folderOf(inside).sessions()).length, 1, stateDir);
    }
    assert.deepEqual(logger.lines, []);
  });

  it("are read in the default state folder, with one warning, when the configuration declares one that is no path inside the repository", async () => {
    const outside = new TestRepository();
    outside.journal(SECOND, "{}\n");
    for (const stateDir of [3, `${outside.root}/.oqas`, "../outside", "..", "var/../../outside"]) {
      const repository = new TestRepository({ repository: { stateDir } });
      repository.journal(FIRST, "{}\n");
      const folder = folderOf(repository);
      logger.lines.length = 0;
      assert.deepEqual(
        (await folder.sessions()).map(({ id }) => id),
        [FIRST],
        String(stateDir),
      );
      await folder.runs();
      assert.deepEqual(logger.lines, [
        "warn repository.stateDir of oqas.json must be a relative path inside the test repository: the runs are read in .oqas instead. Solo",
      ]);
    }
  });
});

describe("the files of a run", () => {
  it("are its journal, its inbox, its state, and the traces started from its start on and before the next run, in the order they started", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, "{}\n");
    repository.journal(SECOND, "{}\n");
    repository.trace("before-any-run", "2026-11-14T08-59-59-999Z", "{}\n");
    repository.trace("writer", stampOf(FIRST, 30), "{}\n");
    repository.trace("planner", stampOf(FIRST), "{}\n");
    repository.trace("explorer", stampOf(FIRST, 59), "{}\n");
    repository.trace("a-reviewer", stampOf(FIRST, 30), "{}\n");
    repository.trace("planner", stampOf(SECOND), "{}\n");
    repository.trace("writer", stampOf(SECOND, 45), "{}\n");
    repository.write("traces/notes.jsonl", "{}\n");
    repository.write(`traces/planner-${stampOf(FIRST, 10)}.txt`, "not a trace");
    const folder = folderOf(repository);
    assert.deepEqual(await folder.files(FIRST), {
      id: FIRST,
      journal: repository.journalPath(FIRST),
      inbox: repository.inboxPath(FIRST),
      state: repository.statePath(FIRST),
      traces: [
        repository.tracePath("planner", stampOf(FIRST)),
        repository.tracePath("a-reviewer", stampOf(FIRST, 30)),
        repository.tracePath("writer", stampOf(FIRST, 30)),
        repository.tracePath("explorer", stampOf(FIRST, 59)),
      ],
    });
    assert.deepEqual((await folder.files(SECOND))?.traces, [
      repository.tracePath("planner", stampOf(SECOND)),
      repository.tracePath("writer", stampOf(SECOND, 45)),
    ]);
    assert.deepEqual(
      (await folder.runs()).map(({ id }) => id),
      [FIRST, SECOND],
    );
    assert.equal(await folder.files(THIRD), undefined);
  });
});
