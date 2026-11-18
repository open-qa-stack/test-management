import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";
import { setTimeout as pause } from "node:timers/promises";
import { Logger } from "@nestjs/common";
import type { SessionEvent } from "@open-qa-stack/shared/sessions";
import { firstValueFrom, lastValueFrom, type Observable, toArray } from "rxjs";
import { SessionError } from "../src/sessions/session-error.ts";
import { RunFolder } from "../src/solo/run-folder.ts";
import { RunLauncher } from "../src/solo/run-launcher.ts";
import { SoloSessionSource } from "../src/solo/solo-session-source.ts";
import type { SoloOptions } from "../src/solo/solo-options.ts";
import { stopProcessGroup } from "../src/solo/stop-process-group.ts";
import { CapturedLogger } from "./support/captured-logger.ts";
import { fakeOqas } from "./support/fake-oqas.ts";
import { at, entry, traced } from "./support/run-lines.ts";
import { FIRST, stampOf, TestRepository } from "./support/test-repository.ts";

const logger = new CapturedLogger();
Logger.overrideLogger(logger);

/** What the bridge logged since the log was last read, which empties it. */
function logged(): string[] {
  return logger.lines.splice(0);
}

/** Whether a process is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The source of a repository, read at a pace fit for tests. */
function sourceOf(repository: TestRepository, options: Partial<SoloOptions> = {}): SoloSessionSource {
  return new SoloSessionSource({ repository: repository.root, pollMs: 10, settleMs: 0, openWaitMs: 5000, ...options });
}

/** Follows events until a number of them came, then leaves; fails when they end before. */
function take(events: Observable<SessionEvent>, count: number): Promise<SessionEvent[]> {
  return new Promise((resolve, reject) => {
    const taken: SessionEvent[] = [];
    const subscription = events.subscribe({
      next: (event) => {
        taken.push(event);
        if (taken.length < count) return;
        subscription.unsubscribe();
        resolve(taken);
      },
      error: reject,
      complete: () => reject(new Error(`The events ended after ${taken.length} of ${count}.`)),
    });
  });
}

/** Waits until something is true, for a second at most. */
async function eventually(check: () => boolean): Promise<void> {
  for (let waited = 0; waited < 1000 && !check(); waited += 10) await pause(10);
  assert.ok(check());
}

/** The failure of an opening that is refused. */
async function refusalOf(opening: Promise<unknown>): Promise<SessionError> {
  const error: unknown = await opening.then(
    () => undefined,
    (raised: unknown) => raised,
  );
  assert.ok(error instanceof SessionError);
  return error;
}

const noted = (seconds: number, text: string) => entry(seconds, "configuration", "info", text);

describe("the sessions of the command line", () => {
  it("are the runs of the test repository, and its project the repository", async () => {
    const repository = new TestRepository({ applications: [{ id: "shop", name: "Shop" }] });
    repository.journal(FIRST, noted(1, "One."));
    repository.end(FIRST, { brief: "cover the profile", exitCode: 0 });
    const source = sourceOf(repository);
    assert.deepEqual(await source.project(), { name: basename(repository.root), applications: [{ id: "shop", name: "Shop" }] });
    const session = await source.session(FIRST);
    assert.deepEqual([session?.id, session?.request, session?.state], [FIRST, "cover the profile", "completed"]);
    assert.deepEqual(await source.sessions(), [session]);
    assert.equal(await source.session("oqas-2026-11-14T10-00-00-000Z"), undefined);
  });

  it("read the clock of the machine and their default paces when given none", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    const source = new SoloSessionSource({ repository: repository.root });
    assert.equal((await source.session(FIRST))?.state, "running");
    assert.deepEqual(await firstValueFrom(source.events(FIRST, 0)), { id: 1, at: at(1), type: "note", phase: "configuration", text: "One." });
  });
});

describe("the events of a session of the command line", () => {
  it("are those its run wrote, in the order of their identifiers, then those it writes", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.trace("planner", stampOf(FIRST), traced(2, "plan", "agent", { type: "text", text: "Two." }));
    const events = sourceOf(repository).events(FIRST, 0);
    const followed = take(events, 4);
    assert.deepEqual(
      (await take(events, 2)).map(({ id, type }) => [id, type]),
      [
        [1, "note"],
        [2, "agent_message"],
      ],
    );
    repository.journal(FIRST, noted(3, "Three."));
    repository.end(FIRST, { exitCode: 0 });
    assert.deepEqual(
      (await followed).map(({ id, type }) => [id, type]),
      [
        [1, "note"],
        [2, "agent_message"],
        [3, "note"],
        [4, "state_changed"],
      ],
    );
  });

  it("end once they told that the session is completed, and at once when that is already known", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.end(FIRST, { exitCode: 0 });
    const source = sourceOf(repository);
    const whole = await lastValueFrom(source.events(FIRST, 0).pipe(toArray()));
    assert.deepEqual(
      whole.map(({ id, type }) => [id, type]),
      [
        [1, "note"],
        [2, "state_changed"],
      ],
    );
    assert.deepEqual(await lastValueFrom(source.events(FIRST, 2).pipe(toArray())), []);
    assert.deepEqual(await lastValueFrom(source.events(FIRST, 7).pipe(toArray())), []);
  });

  it("end once they told that the session is interrupted", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    repository.touch(repository.journalPath(FIRST), new Date(at(2)));
    const told = await lastValueFrom(sourceOf(repository).events(FIRST, 1).pipe(toArray()));
    assert.deepEqual(told, [{ id: 2, at: at(2), type: "state_changed", state: "interrupted" }]);
  });

  it("start after the last one already known, under the same identifiers", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One.") + noted(2, "Two.") + noted(3, "Three."));
    const source = sourceOf(repository);
    assert.deepEqual(
      (await take(source.events(FIRST, 1), 2)).map(({ id }) => id),
      [2, 3],
    );
    repository.journal(FIRST, noted(4, "Four."));
    assert.deepEqual(
      (await take(source.events(FIRST, 3), 1)).map(({ id }) => id),
      [4],
    );
  });

  it("are read only while they are followed", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    const told: SessionEvent[] = [];
    const leaving = sourceOf(repository)
      .events(FIRST, 0)
      .subscribe((event) => told.push(event));
    leaving.unsubscribe();
    const subscription = sourceOf(repository)
      .events(FIRST, 0)
      .subscribe((event) => told.push(event));
    await eventually(() => told.length === 1);
    subscription.unsubscribe();
    repository.journal(FIRST, noted(2, "Two."));
    await pause(50);
    assert.equal(told.length, 1);
  });

  it("fail when the run can no longer be read", async () => {
    const repository = new TestRepository();
    repository.journal(FIRST, noted(1, "One."));
    const events = sourceOf(repository).events(FIRST, 0);
    const failure = new Promise<unknown>((resolve) => events.subscribe({ error: resolve, complete: () => resolve("ended without failing") }));
    await take(events, 1);
    repository.remove(repository.journalPath(FIRST));
    const error = await failure;
    assert.ok(error instanceof Error && error.message === `The test repository no longer holds the run ${FIRST}.`);
  });
});

describe("the opening of a session of the command line", () => {
  it("is refused when the command that starts oqas is not configured", async () => {
    const refusal = await refusalOf(sourceOf(new TestRepository()).open({ request: "cover the profile" }));
    assert.equal(refusal.failure, "unavailable");
    assert.match(refusal.message, /OQAS_SOLO_COMMAND/);
  });

  it("starts the command on the repository with the request, and answers the running session of the run once its journal exists", async () => {
    const repository = new TestRepository();
    const source = sourceOf(repository, { command: fakeOqas("starts", "--follow") });
    const before = Date.now();
    const session = await source.open({ request: "cover the profile\nand the orders" });
    assert.equal(session.state, "running");
    assert.match(session.id, /^oqas-\d{4}-/);
    assert.ok(Date.parse(session.openedAt) >= before && Date.parse(session.openedAt) <= Date.now());
    assert.deepEqual(await source.sessions(), [session]);
    const [written] = readFileSync(repository.journalPath(session.id), "utf8").split("\n");
    assert.deepEqual(JSON.parse((JSON.parse(String(written)) as { message: string }).message), [
      "--follow",
      "--repository",
      repository.root,
      "--brief",
      "cover the profile\nand the orders",
    ]);
  });

  it("names the environment when the request does", async () => {
    const repository = new TestRepository();
    const session = await sourceOf(repository, { command: fakeOqas("starts") }).open({ request: "cover the profile", environment: "staging" });
    assert.match(readFileSync(repository.journalPath(session.id), "utf8"), /\\"--brief\\",\\"cover the profile\\",\\"--environment\\",\\"staging\\"\]/);
  });

  it("starts the command in the environment it is given, and in an empty one when it is given none", async () => {
    const repository = new TestRepository();
    const given = (id: string) => String(readFileSync(repository.journalPath(id), "utf8").split("\n")[1]);
    const first = await sourceOf(repository, { command: fakeOqas("starts"), environment: { SHOP_URL: "http://127.0.0.1:3000" } }).open({ request: "first" });
    assert.match(given(first.id), /"environment: (\w+,)*SHOP_URL(,\w+)*"/);
    repository.end(first.id, {});
    const second = await sourceOf(repository, { command: fakeOqas("starts") }).open({ request: "second" });
    assert.doesNotMatch(given(second.id), /SHOP_URL/);
  });

  it("is refused while another is being opened, and while a session is running: one run works in the repository at a time", async () => {
    const repository = new TestRepository();
    const source = sourceOf(repository, { command: fakeOqas("starts") });
    const [opened, concurrent] = await Promise.allSettled([source.open({ request: "first" }), source.open({ request: "second" })]);
    assert.ok(opened.status === "fulfilled" && concurrent.status === "rejected");
    const first = opened.value;
    assert.ok(concurrent.reason instanceof SessionError);
    assert.deepEqual(
      [concurrent.reason.failure, concurrent.reason.message],
      ["session_running", "A session is being opened: wait for its end before opening another."],
    );
    const refusal = await refusalOf(source.open({ request: "third" }));
    assert.deepEqual([refusal.failure, refusal.message], ["session_running", `The session ${first.id} is running: wait for its end before opening another.`]);
    assert.equal((await source.sessions()).length, 1);
    repository.end(first.id, { exitCode: 0 });
    const next = await source.open({ request: "fourth" });
    assert.notEqual(next.id, first.id);
    assert.match(readFileSync(repository.journalPath(next.id), "utf8"), /fourth/);
  });

  it("can be asked again once it was refused", async () => {
    const source = sourceOf(new TestRepository(), { command: fakeOqas("leaves") });
    for (const request of ["first", "second"]) assert.equal((await refusalOf(source.open({ request }))).failure, "not_opened");
    logged();
  });

  it("is refused without the error output of the command, whose last lines are logged, when it stops before it starts a run", async () => {
    logged();
    const refusal = await refusalOf(sourceOf(new TestRepository(), { command: fakeOqas("fails") }).open({ request: "cover the profile" }));
    assert.deepEqual(
      [refusal.failure, refusal.message],
      ["not_opened", "The command stopped before opening a session; the log of the instance has its output."],
    );
    assert.deepEqual(logged(), [
      `warn ${["The command stopped before opening a session:", ...Array.from({ length: 10 }, (_, rank) => `error line ${rank + 3}`)].join("\n")} Solo`,
    ]);
  });

  it("is refused, which is logged without more, when the command stops without a word", async () => {
    logged();
    const refusal = await refusalOf(sourceOf(new TestRepository(), { command: fakeOqas("leaves") }).open({ request: "cover the profile" }));
    assert.equal(refusal.failure, "not_opened");
    assert.deepEqual(logged(), ["warn The command stopped before opening a session, without a word. Solo"]);
  });

  it("is refused, and why is logged, when the command cannot be started", async () => {
    logged();
    const missing = join(new TestRepository().root, "no-such-program");
    const refusal = await refusalOf(sourceOf(new TestRepository(), { command: [missing] }).open({ request: "cover the profile" }));
    assert.deepEqual(
      [refusal.failure, refusal.message],
      ["not_opened", "The command stopped before opening a session; the log of the instance has its output."],
    );
    const [absent, ...others] = logged();
    assert.match(String(absent), /^warn The command stopped before opening a session:\nspawn .*no-such-program ENOENT Solo$/);
    assert.deepEqual(others, []);
    const unusable = await refusalOf(sourceOf(new TestRepository(), { command: fakeOqas("starts") }).open({ request: "cover\0the profile" }));
    assert.deepEqual(
      [unusable.failure, unusable.message],
      ["not_opened", "The command that opens a session could not be started; the log of the instance says why."],
    );
    const [refused, ...more] = logged();
    assert.match(String(refused), /^warn The command that opens a session could not be started: TypeError.* Solo$/s);
    assert.deepEqual(more, []);
  });

  it("is the session of a run whose command wrote its journal and stopped while the runs were listed", async () => {
    const repository = new TestRepository();
    /** A folder whose second listing, the first of an opening that waits for its run, answers what it read before the run started. */
    class LateFolder extends RunFolder {
      #listings = 0;

      override async runs(): ReturnType<RunFolder["runs"]> {
        const runs = await super.runs();
        if (++this.#listings !== 2) return runs;
        await eventually(() => existsSync(join(repository.root, ".oqas", "runs")));
        await pause(100);
        return runs;
      }
    }
    const launcher = new RunLauncher(new LateFolder(repository.root, () => new Date()), repository.root, fakeOqas("flashes"), {}, 10, 5000);
    const session = await launcher.open({ request: "cover the profile" });
    assert.match(session.id, /^oqas-\d{4}-/);
    assert.deepEqual(logged(), []);
  });

  it("gives up, and stops the command and what it started, when the run has not started in time", async () => {
    const repository = new TestRepository();
    const refusal = await refusalOf(sourceOf(repository, { command: fakeOqas("hangs"), openWaitMs: 600 }).open({ request: "cover the profile" }));
    assert.deepEqual([refusal.failure, refusal.message], ["opening_timed_out", "The session did not start within 600 ms; the command was stopped."]);
    const pids = join(repository.root, "pids");
    assert.ok(existsSync(pids), "the command had not started yet");
    const [command, startedByIt] = readFileSync(pids, "utf8").split(" ").map(Number);
    assert.ok(command !== undefined && startedByIt !== undefined);
    await eventually(() => !alive(command) && !alive(startedByIt));
  });
});

describe("the group of a program", () => {
  it("is left alone when the program never started, or is gone already", async () => {
    stopProcessGroup(undefined);
    const gone = spawn(process.execPath, ["--eval", ""], { detached: true, stdio: "ignore" });
    await once(gone, "exit");
    stopProcessGroup(gone.pid);
    assert.equal(gone.exitCode, 0);
  });
});
