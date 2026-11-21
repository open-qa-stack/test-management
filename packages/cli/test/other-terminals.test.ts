import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { join } from "node:path";
import type { Session, SessionEvent } from "@open-qa-stack/domain/sessions";
import { USAGE } from "../src/index.ts";
import { chain, program, sessionOf, Terminal, workspace, type Ran } from "./support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "Test the listing of the orders."];

/** The JSON Lines a program printed, read. */
const lines = <Line>(ran: Ran): Line[] =>
  ran.out
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Line);

let terminal: Terminal;
afterEach(() => terminal.close());

/** Opens a session in the process of the tests, held before its design, and gives its identifier with its end. */
async function held(): Promise<{ id: string; ended: Promise<Ran>; open: () => void }> {
  const door = terminal.designDoor();
  let named: (id: string) => void = () => undefined;
  const id = new Promise<string>((resolve) => (named = resolve));
  const ended = terminal.oqas(BRIEF, {
    heard: (text) => {
      if (text.startsWith("Session ")) named(sessionOf(text));
    },
  });
  await door.reached;
  return { id: await id, ended, open: door.open };
}

describe("oqas, from another terminal: another process on the database of the test repository", () => {
  it("lists the session a command runs, says something to it, which its agents receive, and follows it to its end", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    const listed = lines<Session>(await terminal.program("sessions", "--output", "json"));
    assert.deepEqual(
      listed.map(({ id, state }) => [id, state]),
      [[running.id, "running"]],
    );
    assert.deepEqual(await terminal.program("say", running.id.slice(-8), "Only what a customer sees."), {
      code: 0,
      out: `Message 1 is taken by the session ${running.id}.\n`,
      err: "",
    });
    const attached = terminal.program("attach", running.id, "--output", "json");
    // The process of the tests, which runs the session, beats many times while a program starts: it holds the message by now.
    await terminal.program("show", running.id);
    running.open();
    const [opened, followed] = await Promise.all([running.ended, attached]);
    assert.equal(opened.code, 0, opened.err);
    assert.deepEqual([followed.code, followed.err], [0, ""]);
    const thread = await terminal.thread(running.id);
    assert.deepEqual(lines<SessionEvent>(followed), thread);
    assert.deepEqual(
      thread.flatMap((event) => (event.type === "user_message" && event.number !== undefined ? [[event.number, event.text]] : [])),
      [[1, "Only what a customer sees."]],
    );
    assert.deepEqual(
      thread.flatMap((event) => (event.type === "message_delivered" ? [event.message] : [])),
      [1],
    );
    // The process that only read and posted hosted nothing: the session ended as the one that ran it told it.
    assert.match(opened.out, /^Session \S+: completed, passed, /);
  });

  it("stops the session a command runs: the command that runs it interrupts it, and exits with 5", async () => {
    terminal = await Terminal.open(chain());
    const running = await held();
    assert.deepEqual(await terminal.program("stop", running.id), {
      code: 0,
      out: `The session ${running.id} is asked to stop: the process that runs it interrupts it.\n`,
      err: "",
    });
    await terminal.program("show", running.id);
    running.open();
    const opened = await running.ended;
    assert.equal(opened.code, 5);
    assert.equal(opened.out, `Session ${running.id}: interrupted.\n`);
    const shown = await terminal.program("show", running.id);
    assert.match(shown.out, new RegExp(`^Session ${running.id}: interrupted\\.\\n`));
    assert.match(shown.out, /\n\d\d:\d\d:\d\d session interrupted\n$/);
  });
});

describe("oqas, as a program", () => {
  it("prints its usage, refuses a wrong argument with 3, and stops with 3 in a folder that holds no configuration", async () => {
    assert.deepEqual(await program(["--help"]), { code: 0, out: USAGE, err: "" });
    assert.deepEqual(await program(["--push"]), { code: 3, out: "", err: "Unknown option --push; see oqas --help.\n" });
    const empty = mkdtempSync(join(workspace, "empty-"));
    const missing = await program(["sessions"], empty);
    assert.equal(missing.code, 3);
    assert.match(missing.err, /oqas\.json is missing\. Start with oqas --ui, which sets it up step by step/);
  });

  it("opens a session and exits with the code of its run, its outputs written whole", async () => {
    terminal = await Terminal.open([]);
    const run = await terminal.program("--environment", "nowhere", "--brief", "Test the returns.");
    assert.equal(run.code, 3);
    const id = sessionOf(run.err);
    assert.equal(run.out, `Session ${id}: interrupted.\n`);
    assert.match(
      run.err,
      /\n\[configuration\] error: The environment nowhere is not declared; the configuration declares local, staging\.\n\d\d:\d\d:\d\d session interrupted\n$/,
    );
    const json = await terminal.program("show", id, "--output", "json");
    assert.deepEqual(
      lines<SessionEvent>(json).map((event) => event.type),
      ["user_message", "state_changed", "phase_started", "refusal", "state_changed"],
    );
  });
});
