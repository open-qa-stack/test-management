import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { scriptedServer } from "@open-qa-stack/testing";
import type { PersonMessage, TraceLine } from "@open-qa-stack/domain";
import { liveRuntime, Run, type RunInbox } from "../src/index.ts";
import { chain, configText, FakeRunner, journalOf, plugged, repository, WITNESS } from "./run-support.ts";

/** An inbox a test speaks to, and what its sessions received. */
function inboxOf(unreadable?: string): RunInbox & { say(text: string): void } {
  const sent: PersonMessage[] = [];
  let received = 0;
  return {
    say: (text) => void sent.push({ number: sent.length + 1, text }),
    pending: () => sent.slice(received),
    heard: () => sent.slice(0, received),
    delivered: (through) => void (received = through),
    unreadable,
  };
}

/** Runs the whole chain in a new test repository with the inbox given; the tests run at the end call `atExecution`. */
async function spoken(inbox: RunInbox, atExecution: () => void = () => undefined) {
  const server = await scriptedServer(chain());
  const root = repository(configText(server.baseUrl));
  const host = plugged(root);
  let ran = false;
  const script = {
    final: () => {
      if (!ran) atExecution();
      ran = true;
      return "expected" as const;
    },
  };
  try {
    const code = await new Run({
      repositoryRoot: root,
      environment: "local",
      env: { SHOP_DB_URL: WITNESS },
      ...host.ports,
      openInbox: () => inbox,
      openRuntime: (config) => liveRuntime(config, {}),
      runner: new FakeRunner(root, script),
      now: () => new Date("2026-11-13T12:00:00.000Z"),
    }).run();
    return { code, root, err: host.err, out: host.out };
  } finally {
    await server.close();
  }
}

/** The lines of the traces of a run, the cartography first. */
const traced = (root: string) => {
  const folder = join(root, ".oqas", "traces");
  return readdirSync(folder)
    .sort()
    .flatMap((name) => readFileSync(join(folder, name), "utf8").trim().split("\n"))
    .map((line) => JSON.parse(line) as TraceLine);
};

describe("a person who speaks to a run, through the inbox its host opens", () => {
  it("is heard by the agent at work, and told in the summary which message came once no agent was", async () => {
    const inbox = inboxOf();
    inbox.say("The orders are the only domain.");
    // The tests run once the design is over: no session opens any more.
    const run = await spoken(inbox, () => inbox.say("Test the returns too."));
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(
      traced(run.root).flatMap((line) => (line.event.type === "person" ? [[line.phase, line.event.message, line.event.text]] : [])),
      [["consolidation", 1, "The orders are the only domain."]],
    );
    // What the person said to the cartography holds for the design: its first session is recalled it.
    const planning = traced(run.root).find((line) => line.phase === "plan" && line.event.type === "message")!;
    assert.match(
      (planning.event as { readonly text: string }).text,
      /\n\nThe person who asked for this run said this earlier in the run, and it still holds:\n<person-message number="1">The orders are the only domain\.<\/person-message>$/,
    );
    const summary = journalOf(run.root).filter((entry) => entry.step === "summary" && entry.event === "info");
    assert.deepEqual(
      summary.map((entry) => entry.message),
      ["The message 2 of the person was not delivered: no agent was at work to receive it."],
    );
    assert.match(run.err, /\[summary\] The message 2 of the person was not delivered/);
    assert.doesNotMatch(run.out, /person/);
  });
});

describe("a run whose inbox cannot be read", () => {
  it("goes to its end without it, and says so once, in the journal of its summary", async () => {
    const run = await spoken(inboxOf("the conversation is closed"));
    assert.equal(run.code, 0, run.err);
    const told = journalOf(run.root).filter((entry) => entry.message.includes("inbox"));
    assert.deepEqual(
      told.map((entry) => [entry.step, entry.event, entry.message]),
      [["summary", "error", "The inbox of the run could not be read, and no message of it was delivered: the conversation is closed"]],
    );
  });
});
