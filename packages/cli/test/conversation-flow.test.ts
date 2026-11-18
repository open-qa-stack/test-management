import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { afterEach, describe, it } from "vitest";
import { DatabaseUrl } from "@open-qa-stack/store";
import { SessionEndedError } from "@open-qa-stack/domain";
import { contextOf, reasonOf } from "../src/solo/conversation/converse.ts";
import { widthOf } from "./conversation/screen.ts";
import { FakeTerminal } from "./support/fake-terminal.ts";
import { chain, program, sessionOf, Terminal, workspace, type Ran } from "./support/terminal.ts";

const REQUEST = "Test the listing of the orders.";
const CTRL_C = "\u0003";

/** A built console as small as one can be, for what only needs one to be served. */
const CONSOLE = mkdtempSync(join(workspace, "console-"));
writeFileSync(join(CONSOLE, "index.html"), "<!doctype html><title>console</title>");

let terminal: Terminal;
const open = new Set<Conversing>();
afterEach(async () => {
  // A conversation a failed test left open is left as a person leaves one at once, so that nothing outlives the test.
  for (const conversing of open) {
    // Ctrl-C closes, clears, then arms itself before it leaves: it is pressed until the conversation is left.
    while (open.has(conversing)) {
      conversing.screen.type(CTRL_C);
      await pause(20);
    }
  }
  await terminal.close();
});

/** A conversation opened in a terminal of the tests: its screen, and its end. */
interface Conversing {
  readonly screen: FakeTerminal;
  readonly ended: Promise<Ran>;
}

/** Opens the conversation in the test repository, and waits for its input. */
async function conversing(argv: readonly string[] = ["--environment", "local"], io: Parameters<Terminal["oqas"]>[1] = {}): Promise<Conversing> {
  const screen = new FakeTerminal();
  const ended = terminal.oqas(argv, { ...io, env: { LANG: "en_US.UTF-8", ...io.env }, io: { terminal: screen, ...io.io } });
  const conversing = { screen, ended };
  open.add(conversing);
  void ended.finally(() => open.delete(conversing));
  await screen.sees("What do we test?");
  return conversing;
}

describe("oqas, without a command, in a terminal", () => {
  it("opens a session with what the person types, follows it live, takes what they say to its agents, and exits with the code of its run", async () => {
    terminal = await Terminal.open(chain());
    const door = terminal.designDoor();
    const { screen, ended } = await conversing();
    assert.match(
      screen.text,
      new RegExp(`^Open QA Stack · ${basename(terminal.root)}\\n.*${basename(terminal.root)}\\nenvironment local · database SQLite\\n\\nNo session yet\\.\\n`),
    );
    await screen.enter(REQUEST);
    await screen.sees(/Session session-\S+ · opened \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/);
    await door.reached;
    await screen.enter("Only what a customer sees.");
    await screen.sees("› You · message 1\n  Only what a customer sees.\n  waiting for an agent");
    assert.match(screen.text, /\n. running · Cartography · index · \d+ s\n›  Say something to the agents\n {2}Enter send · \/ commands · Ctrl-C stop\n$/);
    door.open();
    await screen.sees("  Only what a customer sees.\n  delivered to the planner");
    await screen.sees("Session completed · tests passed");
    const { text } = screen;
    // The same story as the console: the phases, who speaks, what they do, what the harness decides, and the result.
    assert.match(text, /── Plan · functional ─+\n\n■ Harness → Planner\n {2}Plan Playwright tests for the environment local\./);
    assert.match(text, /◆ Planner\n {2}· Read section 1 of order-specs · \d+(\.\d)? m?s\n {2}· Proposed a plan of 3 scenarios · /);
    assert.match(text, /── Writing a test · test-1\n/);
    assert.match(text, /● Writer\n {2}✓ Ran "[^"\n]+" · /);
    assert.match(
      text,
      / {2}Verdicts of the run: 3 tests\n✓ passed {2}the test\n✓ passed {2}the test\n✓ passed {2}the test\n\nSession completed · tests passed\n[\d.]+ s · 17 model requests · 3 of 3 tests passed · branch oqas\/design-\d{8}T\d{6}Z\n/,
    );
    await screen.sees("›  What do we test next?");
    await screen.enter("/quit");
    assert.deepEqual([(await ended).code, (await ended).out, (await ended).err], [0, "", ""]);
    assert.match((await terminal.oqas(["sessions"])).out, /^session-\S+ {2}completed, passed {2}\S+ {2}Test the listing of the orders\.\n$/);
  });

  it("follows a session another terminal runs, speaks to it and stops it, as attach, say and stop do, and exits with 0: it opened none", async () => {
    terminal = await Terminal.open(chain());
    const door = terminal.designDoor();
    let named: (id: string) => void = () => undefined;
    const id = new Promise<string>((resolve) => (named = resolve));
    const other = terminal.oqas(["--environment", "local", "--brief", REQUEST], {
      heard: (text) => {
        if (text.startsWith("Session ")) named(sessionOf(text));
      },
    });
    await door.reached;
    const { screen, ended } = await conversing([]);
    assert.match(
      screen.text,
      new RegExp(`environment the only one declared · database SQLite\\n\\nLatest sessions\\n {2}${(await id).slice(-8)} {2}running {2}${REQUEST}\\n`),
    );
    await screen.enter("/sessions");
    await screen.sees(`Reopen a session\n❯ ${(await id).slice(-8)}  running`);
    screen.type("\r");
    await screen.sees(`Session ${await id} · opened`);
    await screen.sees("Enter send · / commands · Ctrl-C quit");
    await screen.enter("Only what a customer sees.");
    await screen.sees("› You · message 1\n  Only what a customer sees.");
    await screen.enter("/stop");
    await screen.sees(`Stop the session ${await id}?`);
    screen.type("\r");
    await screen.sees("The session is asked to stop: its agents stop as soon as they hand over.");
    door.open();
    await screen.sees("Session interrupted");
    assert.match(screen.text, /■ Harness · automatic check · error · [^\n]+\n(?: {2}[^\n]*\n)? {2}[^\n]*the run was asked to stop\./);
    await screen.enter("/quit");
    assert.equal((await ended).code, 0);
    assert.equal((await other).code, 5);
  });

  it("asks the session it runs to stop at the first Ctrl-C, as oqas --brief does, and exits with 5 once the person leaves", async () => {
    terminal = await Terminal.open(chain());
    const door = terminal.designDoor();
    const { screen, ended } = await conversing();
    await screen.enter(REQUEST);
    await door.reached;
    await screen.sees("Enter send · / commands · Ctrl-C stop");
    screen.type(CTRL_C);
    await screen.sees("The session is asked to stop, and ends soon. Ctrl-C again leaves at once, without waiting for it.");
    door.open();
    await screen.sees("Session interrupted");
    await screen.enter("/quit");
    assert.equal((await ended).code, 5);
    assert.match((await terminal.oqas(["sessions"])).out, /^session-\S+ {2}interrupted /);
  });

  it("leaves at once at the second Ctrl-C, without waiting for the session it runs, and exits with 5", async () => {
    terminal = await Terminal.open(chain());
    const door = terminal.designDoor();
    const { screen, ended } = await conversing();
    await screen.enter(REQUEST);
    await door.reached;
    await screen.sees("Ctrl-C stop");
    screen.type(CTRL_C);
    await screen.sees("Ctrl-C again leaves at once");
    screen.type(CTRL_C);
    assert.equal((await ended).code, 5);
    door.open();
  });

  it("exits with the code of a session that stopped on its configuration, which it tells in the thread, and redraws at the width of a terminal that is resized", async () => {
    terminal = await Terminal.open([]);
    const { screen, ended } = await conversing(["--environment", "nowhere"], { io: { now: () => new Date() } });
    await screen.enter(REQUEST);
    await screen.sees("Session interrupted");
    assert.match(
      screen.text,
      /■ Harness · automatic check · error · Configuration\n {2}The environment nowhere is not declared; the configuration declares local, staging\./,
    );
    screen.resize(60);
    await screen.enter("/help");
    await screen.sees(/Keys\n[\s\S]*What do we test next\?/);
    const narrow = screen.text.slice(screen.text.lastIndexOf("Commands")).split("\n");
    assert.deepEqual(
      narrow.filter((line) => widthOf(line) > 60),
      [],
    );
    assert.ok(narrow.includes("                it to the agents of the session that goes on"));
    await screen.enter("/quit");
    assert.equal((await ended).code, 3);
  });

  it("serves the web console from its process with /ui, on the port it is given, until the person leaves", async () => {
    terminal = await Terminal.open([]);
    const { screen, ended } = await conversing(undefined, { io: { console: CONSOLE } });
    await screen.enter("/ui 0");
    await screen.sees(/The web console is served at http:\/\/127\.0\.0\.1:\d+ until you leave\./);
    const url = /served at (http:\/\/127\.0\.0\.1:\d+) until/.exec(screen.text)![1]!;
    assert.match(await (await fetch(`${url}/`)).text(), /<title>console<\/title>/);
    assert.equal((await fetch(`${url}/api/sessions`)).status, 200);
    // Asked again, it says where the console already is.
    await screen.enter("/ui 0");
    await screen.sees(new RegExp(`served at ${url} until you leave\\.[\\s\\S]*served at ${url} until you leave\\.`));
    await screen.enter("/quit");
    assert.equal((await ended).code, 0);
    await assert.rejects(fetch(`${url}/`));
  });

  it("tells in the thread why the web console cannot be served, with what to do, and may be asked again", async () => {
    terminal = await Terminal.open([]);
    const unbuilt = mkdtempSync(join(workspace, "unbuilt-"));
    const { screen, ended } = await conversing(undefined, { io: { console: unbuilt } });
    await screen.enter("/ui 0");
    // The path of the folder is as long as the temporary folder of the machine: the message wraps anywhere.
    await screen.sees(
      /✗ The console is not built:\s[\s\S]*holds\s+no\s+index\.html\.\s+Run\s+pnpm\s+build\s+at\s+the\s+root\s+of\s+the\s+workspace,\s+then\s+oqas\s+--ui\s+again\./,
    );
    mkdirSync(unbuilt, { recursive: true });
    writeFileSync(join(unbuilt, "index.html"), "<!doctype html>");
    await screen.enter("/ui 0");
    await screen.sees(/The web console is served at http:\/\/127\.0\.0\.1:\d+ until you leave\./);
    await screen.enter("/quit");
    assert.equal((await ended).code, 0);
  });
});

describe("oqas, without a command, where it cannot open its conversation", () => {
  it("is refused with 3 outside a terminal, and when it is told to ask nothing, and names --brief", async () => {
    terminal = await Terminal.open([]);
    assert.deepEqual(await terminal.oqas([]), {
      code: 3,
      out: "",
      err: "oqas opens its conversation in a terminal, and this is not one: say what to test with --brief, or name a command; see oqas --help.\n",
    });
    assert.deepEqual(await terminal.oqas(["--no-input"], { io: { terminal: new FakeTerminal() } }), {
      code: 3,
      out: "",
      err: "Say what to test with --brief, or name a command; see oqas --help.\n",
    });
    // The program itself, whose input and output are no terminal here.
    const ran = await program(["--repository", terminal.root]);
    assert.deepEqual([ran.code, ran.out], [3, ""]);
    assert.match(ran.err, /^oqas opens its conversation in a terminal, and this is not one: /);
  });

  it("draws nothing when its database cannot be reached, and says why on the error output, with what was reported meanwhile", async () => {
    terminal = await Terminal.open([]);
    const screen = new FakeTerminal();
    const ran = await terminal.oqas([], { env: { OQAS_DATABASE_URL: "postgres://oqas:witness-7e1a@127.0.0.1:1/oqas" }, io: { terminal: screen } });
    assert.equal(ran.code, 5);
    assert.match(ran.err, /^oqas: The database is unreachable: .*\nThe database is unreachable: /);
    assert.equal(screen.text, "");
  });
});

describe("where a conversation takes place", () => {
  it("is the project the instance keeps, or the folder of its repository before any host started it, with the kind of its database", () => {
    const file = DatabaseUrl.ofFile("/work/shop-tests/.oqas/oqas.db");
    const server = DatabaseUrl.parse("postgres://oqas@db.example/oqas")!;
    assert.deepEqual(contextOf({ applications: [] }, "/work/shop-tests", file, undefined), {
      project: "shop-tests",
      repository: "/work/shop-tests",
      database: "SQLite",
    });
    assert.deepEqual(contextOf({ name: "Shop", applications: [] }, "/work/shop-tests", server, "staging"), {
      project: "Shop",
      repository: "/work/shop-tests",
      database: "PostgreSQL",
      environment: "staging",
    });
  });
});

describe("why something failed, as a conversation tells it", () => {
  it("is what the other commands say of a refusal, and is told as unexpected for what nothing foresaw, an error or not", () => {
    assert.equal(reasonOf(new SessionEndedError("session-1")), "The session session-1 no longer goes on.");
    assert.equal(reasonOf(new Error("The disk is full.")), "Unexpected error: The disk is full.");
    assert.equal(reasonOf("nothing"), "Unexpected error: nothing");
  });
});
