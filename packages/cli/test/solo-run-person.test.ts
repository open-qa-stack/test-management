import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { runInboxFile, type TraceLine } from "@open-qa-stack/domain";
import { followedLine } from "../src/index.ts";
import { chain, FIRST_RUN, journalOf, later, repository, solo } from "./solo-run-support.ts";

/** Appends a message to the inbox of the first run of a test repository, as a person does by hand. */
function say(root: string, text: string): void {
  const runs = join(root, ".oqas", "runs");
  mkdirSync(runs, { recursive: true });
  appendFileSync(join(runs, runInboxFile(FIRST_RUN)), `${JSON.stringify({ at: "2026-11-13T12:00:30.000Z", text })}\n`);
}

/** The lines of the traces of a run, the cartography first. */
const traced = (root: string) => {
  const folder = join(root, ".oqas", "traces");
  return readdirSync(folder)
    .sort()
    .flatMap((name) => readFileSync(join(folder, name), "utf8").trim().split("\n"))
    .map((line) => JSON.parse(line) as TraceLine);
};

describe("a person who speaks to a run of the solo command", () => {
  it("is heard by the agent at work, and told in the summary which message came once no agent was", async () => {
    let root = "";
    let late = false;
    const run = await solo(chain(), {
      environment: "local",
      now: later(12),
      root: (config) => {
        root = repository(config);
        say(root, "The orders are the only domain.");
        return root;
      },
      script: {
        // The tests run once the design is over: no session opens any more.
        final: () => {
          if (!late) say(root, "Test the returns too.");
          late = true;
          return "expected";
        },
      },
    });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(
      traced(root).flatMap((line) => (line.event.type === "person" ? [[line.phase, line.event.message, line.event.text]] : [])),
      [["consolidation", 1, "The orders are the only domain."]],
    );
    // What the person said to the cartography holds for the design: its first session is recalled it.
    const planning = traced(root).find((line) => line.phase === "plan" && line.event.type === "message")!;
    assert.match(
      (planning.event as { readonly text: string }).text,
      /\n\nThe person who asked for this run said this earlier in the run, and it still holds:\n<person-message number="1">The orders are the only domain\.<\/person-message>$/,
    );
    const summary = journalOf(root).filter((entry) => entry.step === "summary" && entry.event === "info");
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
    const run = await solo(chain(), {
      environment: "local",
      now: later(12),
      root: (config) => {
        const root = repository(config);
        mkdirSync(join(root, ".oqas", "runs", runInboxFile(FIRST_RUN)), { recursive: true });
        return root;
      },
    });
    assert.equal(run.code, 0, run.err);
    const told = journalOf(run.root).filter((entry) => entry.message.includes("inbox"));
    assert.deepEqual(
      told.map((entry) => [entry.step, entry.event]),
      [["summary", "error"]],
    );
    assert.match(told[0]!.message, /^The inbox of the run could not be read, and no message of it was delivered: EISDIR/);
  });
});

describe("following a run a person speaks to", () => {
  it("prints the message a session receives, with its number, on one line", () => {
    const line: TraceLine = {
      at: "2026-11-13T12:34:56.000Z",
      phase: "plan",
      actor: "harness",
      event: { type: "person", message: 2, text: "Search by last name,\n  not by first name." },
    };
    assert.equal(followedLine(line), "12:34:56 plan person (message 2): Search by last name, not by first name.");
  });
});
