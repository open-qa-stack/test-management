import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { scriptedServer } from "@open-qa-stack/testing";
import type { AgentEvent, AgentRuntime, RunEntry, SessionOptions } from "@open-qa-stack/domain";
import { liveRuntime, Run } from "../src/index.ts";
import { RunStoppedError } from "../src/runtime/run-stopped-error.ts";
import { StoppableRuntime } from "../src/runtime/stoppable-runtime.ts";
import { chain, configText, FakeRunner, plugged, repository, stateOf, WITNESS } from "./run-support.ts";
import { held } from "./support/held.ts";

/**
 * Runs the whole chain in a new test repository, and asks the run to stop when its journal writes a given entry.
 *
 * @param stopAt - Tells the entry the stop is asked at.
 * @param replies - What the model answers, in order.
 */
async function stopped(stopAt: (entry: RunEntry) => boolean, replies: Parameters<typeof scriptedServer>[0] = chain()) {
  const server = await scriptedServer(replies);
  const root = repository(configText(server.baseUrl));
  const host = plugged(root);
  const stop = new AbortController();
  const runner = new FakeRunner(root);
  try {
    const code = await new Run({
      repositoryRoot: root,
      environment: "local",
      env: { SHOP_DB_URL: WITNESS },
      ...host.ports,
      journal: {
        location: (run) => host.ports.journal.location(run),
        keep: (run, earlier) => host.ports.journal.keep(run, earlier),
        entry: (entry) => {
          host.ports.journal.entry(entry);
          if (stopAt(entry)) stop.abort();
        },
      },
      openRuntime: (config) => liveRuntime(config, {}),
      runner,
      now: () => new Date("2026-11-13T12:00:00.000Z"),
      stop: stop.signal,
    }).run();
    return { code, root, err: host.err, server, runner };
  } finally {
    await server.close();
  }
}

/** Whether an entry ends a step. */
const ends = (step: string) => (entry: RunEntry) => entry.step === step && entry.event === "finished";

describe("a run its host asks to stop", () => {
  it("starts no step of its chain once the stop is asked, tells so, and goes to its summary: it ends as a run a step stopped", async () => {
    const { code, root, err, server } = await stopped(ends("prerequisites"));
    assert.equal(code, 5);
    assert.match(err, /\[cartography\] The run was asked to stop: the cartography does not start\./);
    assert.doesNotMatch(err, /The cartography starts|design|execution/);
    assert.match(err, /The summary of the run was written\./);
    assert.equal(server.requests.length, 1, "the model was only checked");
    const state = stateOf(root);
    assert.deepEqual([state.exitCode, state.stoppedBy, state.steps.map(({ step }) => step)], [5, undefined, ["configuration", "prerequisites"]]);
  });

  it("does not design once its cartography is over, nor run the tests its design gave", async () => {
    const afterCartography = await stopped(ends("cartography"));
    assert.equal(afterCartography.code, 5);
    assert.match(afterCartography.err, /The run was asked to stop: the design does not start\./);
    assert.equal(stateOf(afterCartography.root).designed.length, 0);

    const afterDesign = await stopped(ends("design"));
    assert.equal(afterDesign.code, 5);
    assert.match(afterDesign.err, /The run was asked to stop: the execution does not start\./);
    assert.deepEqual([stateOf(afterDesign.root).designed.length, afterDesign.runner.finalRuns], [3, 0]);
  });

  it("stops the step under way in the middle of a call to the model, which no one waits for", async () => {
    // The first call of the cartography is answered after a time no test waits for.
    const replies = chain().map((reply, index) => (index === 1 ? { ...reply, delayMs: 60_000 } : reply));
    const startedAt = Date.now();
    let asked: NodeJS.Timeout | undefined;
    const stop = new AbortController();
    const server = await scriptedServer(replies);
    const root = repository(configText(server.baseUrl));
    const host = plugged(root);
    try {
      const run = new Run({
        repositoryRoot: root,
        environment: "local",
        env: { SHOP_DB_URL: WITNESS },
        ...host.ports,
        follow: () => {
          // The agent that maps the document was sent its request: its call to the model is under way.
          asked ??= setInterval(() => server.requests.length >= 2 && stop.abort(), 5);
        },
        openRuntime: (config) => liveRuntime(config, {}),
        runner: new FakeRunner(root),
        stop: stop.signal,
      });
      assert.equal(await run.run(), 5);
    } finally {
      clearInterval(asked);
      await server.close();
    }
    assert.ok(Date.now() - startedAt < 30_000, `the run ended ${Date.now() - startedAt} ms after it started`);
    assert.match(host.err, /\[cartography\] error: The cartography stopped: the run was asked to stop\./);
    assert.doesNotMatch(host.err, /unexpected error|The design starts/);
    assert.match(host.err, /The summary of the run was written\./);
  });
});

/** A runtime whose sessions answer a message with the events a test gives, one at a time, as the test lets them through. */
function scripted(events: readonly AgentEvent[], gate: () => Promise<void> = async () => undefined) {
  const opened: SessionOptions[] = [];
  const closed: string[] = [];
  const runtime: AgentRuntime = {
    openSession: async (options) => {
      opened.push(options);
      return {
        async *send() {
          for (const event of events) {
            await gate();
            yield event;
          }
        },
        close: async () => void closed.push("session"),
      };
    },
    close: async () => void closed.push("runtime"),
  };
  return { runtime, opened, closed };
}

const OPTIONS: SessionOptions = { instructions: "Map the orders.", tools: [] };
const TURN: readonly AgentEvent[] = [{ type: "text", text: "One." }, { type: "end" }];

/** The events of a turn, read to its end. */
async function turn(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const read: AgentEvent[] = [];
  for await (const event of events) read.push(event);
  return read;
}

describe("a runtime of the agents that can be asked to stop", () => {
  it("opens the sessions of the runtime it stands before, hands their turns over as they are, and closes what it is asked to", async () => {
    const { runtime, opened, closed } = scripted(TURN);
    const stoppable = new StoppableRuntime(runtime, new AbortController().signal);
    const session = await stoppable.openSession(OPTIONS);
    assert.deepEqual(opened, [OPTIONS]);
    assert.deepEqual(await turn(session.send("Go on.")), TURN);
    await session.close();
    await stoppable.close();
    assert.deepEqual(closed, ["session", "runtime"]);
  });

  it("opens no session once the stop is asked, and ends the turn under way at once, whatever the model still has to say", async () => {
    const stop = new AbortController();
    const waiting = held();
    const never = held();
    const { runtime, opened } = scripted(TURN, async () => {
      waiting.resolve();
      await never.promise;
    });
    const stoppable = new StoppableRuntime(runtime, stop.signal);
    const session = await stoppable.openSession(OPTIONS);
    const reading = turn(session.send("Go on."));
    await waiting.promise;
    stop.abort();
    await assert.rejects(reading, (error) => error instanceof RunStoppedError && error.message === "The run was asked to stop.");
    await assert.rejects(turn(session.send("Go on.")), (error) => error instanceof RunStoppedError);
    await assert.rejects(stoppable.openSession(OPTIONS), (error) => error instanceof RunStoppedError);
    assert.equal(opened.length, 1);
  });

  it("ends at once the first turn of a session the stop was asked after it was opened", async () => {
    const stop = new AbortController();
    const { runtime } = scripted(TURN);
    const stoppable = new StoppableRuntime(runtime, stop.signal);
    const session = await stoppable.openSession(OPTIONS);
    stop.abort();
    await assert.rejects(turn(session.send("Go on.")), (error) => error instanceof RunStoppedError);
  });

  it("refuses from its first use when the stop was asked before it was made", async () => {
    const stop = new AbortController();
    stop.abort();
    const { runtime, opened } = scripted(TURN);
    const stoppable = new StoppableRuntime(runtime, stop.signal);
    await assert.rejects(stoppable.openSession(OPTIONS), (error) => error instanceof RunStoppedError);
    assert.deepEqual(opened, []);
  });
});
