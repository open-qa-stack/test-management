import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hintsOf } from "../../src/conversation/view/key-hints.ts";
import { interruptionOf } from "../../src/conversation/state/interruption.ts";
import { requestOf } from "../../src/conversation/state/request.ts";
import { hintedCommands, SLASH_COMMANDS } from "../../src/conversation/state/slash-commands.ts";
import type { ConversationState } from "../../src/conversation/state/conversation-state.ts";
import { after, COMPLETED, FAILED, RUNNING, showing, endOf } from "./fixtures.ts";

const HOME = after([]);
const LIVE = showing();
const ENDED = after(endOf(COMPLETED), LIVE);

/** The conversation with something typed in its input. */
const typing = (input: string, state: ConversationState = HOME): ConversationState => after([{ type: "typed", input }], state);

describe("the commands a person may be typing", () => {
  it("are every command for a slash alone, those whose name starts with what follows it, and none once the name is left", () => {
    assert.deepEqual(hintedCommands("/"), SLASH_COMMANDS);
    assert.deepEqual(
      hintedCommands("/s").map(({ name }) => name),
      ["sessions", "stop", "secrets"],
    );
    assert.deepEqual(
      hintedCommands("/stop").map(({ name }) => name),
      ["stop"],
    );
    for (const input of ["", "s", "/x", "/ui 0", "/stop ", " /stop"]) assert.deepEqual(hintedCommands(input), [], input);
  });
});

describe("what Enter asks", () => {
  it("is nothing when the input is empty", () => {
    for (const input of ["", "   "]) assert.deepEqual(requestOf(typing(input)), { kind: "nothing" });
  });

  it("is to open a session with what was typed when no session is on screen", () => {
    assert.deepEqual(requestOf(typing("  Test the returns. ")), { kind: "open", request: "Test the returns." });
  });

  it("is to resume the session on screen with what was typed once it ended, for a new turn", () => {
    assert.deepEqual(requestOf(typing("Fix the failing test.", ENDED)), { kind: "resume", session: RUNNING.id, text: "Fix the failing test." });
  });

  it("is to say what was typed to the session on screen while it goes on", () => {
    assert.deepEqual(requestOf(typing("Without the profile.", LIVE)), { kind: "say", session: RUNNING.id, text: "Without the profile." });
  });

  it("is the command a slash names, by its name or by the start of it when no other shares it", () => {
    assert.deepEqual(
      ["/sessions", "/new", "/help", "/quit", "/q", "/ses", "/ui", " /help  "].map((input) => requestOf(typing(input))),
      [
        { kind: "sessions" },
        { kind: "new" },
        { kind: "help" },
        { kind: "quit" },
        { kind: "quit" },
        { kind: "sessions" },
        { kind: "ui", port: 6727 },
        { kind: "help" },
      ],
    );
  });

  it("is refused, with why, for a command that is none, one a start names with others, or one given what it does not take", () => {
    const refused = (why: string) => ({ kind: "refused", why });
    assert.deepEqual(requestOf(typing("/resume")), refused("Unknown command /resume; /help lists the commands."));
    assert.deepEqual(requestOf(typing("/s")), refused("Unknown command /s; /help lists the commands."));
    assert.deepEqual(requestOf(typing("/")), refused("Unknown command /; /help lists the commands."));
    assert.deepEqual(requestOf(typing("/quit now")), refused("/quit takes nothing after it."));
    assert.deepEqual(requestOf(typing("/ui 80 90")), refused("/ui takes [port]."));
  });

  it("runs what oqas runs with the words after a command that runs it, and sets the model step by step with /model alone", () => {
    const command = (command: object) => ({ kind: "command", command });
    assert.deepEqual(
      ["/config show", "/kn mapping", "/knowledge check orders", "/secrets", "/init", "/model status", "/model"].map((input) => requestOf(typing(input))),
      [
        command({ name: "config", action: "show" }),
        command({ name: "knowledge", action: "mapping" }),
        command({ name: "knowledge", action: "check", source: "orders" }),
        command({ name: "secrets", action: "list" }),
        command({ name: "init" }),
        command({ name: "model", action: "status" }),
        { kind: "model" },
      ],
    );
  });

  it("refuses, with why, what oqas refuses, an option the conversation sets itself and what does not run in it, and asks a value to type unseen", () => {
    const refused = (why: string) => ({ kind: "refused", why });
    assert.deepEqual(requestOf(typing("/config bogus")), refused("oqas config takes show, import, export, history or check."));
    assert.deepEqual(
      requestOf(typing("/config show --output json")),
      refused("The conversation runs the command in its own test repository, and prints it as lines: it takes no --repository, --output nor --follow."),
    );
    assert.deepEqual(requestOf(typing("/knowledge --help")), refused("oqas knowledge --help does not run in the conversation: run it in another terminal."));
    assert.deepEqual(requestOf(typing("/secrets set MODEL_KEY")), { kind: "secret", variable: "MODEL_KEY" });
  });

  it("gives /ui the port it is given, 0 for any free one, that of oqas --ui by default, and refuses what is no port", () => {
    assert.deepEqual(requestOf(typing("/ui 0")), { kind: "ui", port: 0 });
    assert.deepEqual(requestOf(typing("/ui 65535")), { kind: "ui", port: 65535 });
    for (const port of ["65536", "-1", "http", "123456"])
      assert.deepEqual(requestOf(typing(`/ui ${port}`)), { kind: "refused", why: "/ui takes a port from 0 to 65535, 0 for any free one." }, port);
  });

  it("asks to stop the session on screen while it goes on, and refuses when none does", () => {
    assert.deepEqual(requestOf(typing("/stop", LIVE)), { kind: "stop", session: RUNNING.id });
    for (const state of [HOME, ENDED])
      assert.deepEqual(requestOf(typing("/stop", state)), { kind: "refused", why: "No session goes on here: there is nothing to stop." });
  });

  it("answers what stands over the input: the session the picker has selected, or the stop that is confirmed", () => {
    const picking = after([
      { type: "listed", sessions: [RUNNING, FAILED] },
      { type: "moved", by: 1 },
    ]);
    assert.deepEqual(requestOf(picking), { kind: "pick", session: FAILED });
    assert.deepEqual(requestOf({ ...picking, overlay: { kind: "picker", sessions: [], selected: 0 } }), { kind: "nothing" });
    const stopping = after([{ type: "submitted", request: { kind: "stop", session: RUNNING.id } }], LIVE);
    assert.deepEqual(requestOf(stopping), { kind: "confirm-stop", session: RUNNING.id });
  });
});

describe("what Ctrl-C does", () => {
  it("closes what stands over the input, before anything else", () => {
    assert.deepEqual(interruptionOf(after([{ type: "listed", sessions: [RUNNING] }], typing("x"))), { kind: "dismiss" });
  });

  it("clears what the input holds, before it stops or leaves anything", () => {
    assert.deepEqual(interruptionOf(typing("Test the", LIVE)), { kind: "clear" });
  });

  it("asks the session on screen to stop when this process runs it and it goes on", () => {
    assert.deepEqual(interruptionOf(LIVE), { kind: "stop", session: RUNNING.id });
  });

  it("only arms itself at the start, on a session that ended, and on one another process runs, which it leaves to it", () => {
    for (const state of [HOME, ENDED, showing(undefined, false)]) assert.deepEqual(interruptionOf(state), { kind: "arm" });
  });

  it("leaves when it was just pressed", () => {
    for (const state of [HOME, LIVE]) assert.deepEqual(interruptionOf(after([{ type: "interrupted" }], state)), { kind: "leave" });
  });
});

describe("what the person may do now", () => {
  it("is to open a session at the start, and to go on with the session on screen once it ended, or to open another with /new", () => {
    assert.deepEqual(hintsOf(HOME), { placeholder: "What do we test?", keys: ["Enter open a session", "/ commands", "Ctrl-C quit"] });
    assert.deepEqual(hintsOf(ENDED), { placeholder: "What do the agents do next?", keys: ["Enter go on", "/new another session", "Ctrl-C quit"] });
  });

  it("is to speak to the agents while the session on screen goes on, and to stop it with Ctrl-C when this process runs it", () => {
    assert.deepEqual(hintsOf(LIVE), { placeholder: "Say something to the agents", keys: ["Enter send", "/ commands", "Ctrl-C stop"] });
    assert.deepEqual(hintsOf(showing(undefined, false)).keys, ["Enter send", "/ commands", "Ctrl-C quit"]);
  });

  it("is to answer what stands over the input", () => {
    assert.deepEqual(hintsOf(after([{ type: "listed", sessions: [RUNNING] }])), { placeholder: "", keys: ["Up/Down select", "Enter open", "Esc close"] });
    assert.deepEqual(hintsOf(after([{ type: "submitted", request: { kind: "stop", session: RUNNING.id } }], LIVE)), {
      placeholder: "",
      keys: ["Enter stop it", "Esc keep it going"],
    });
  });
});
