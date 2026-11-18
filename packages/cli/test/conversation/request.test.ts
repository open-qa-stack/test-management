import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hintsOf } from "../../src/solo/conversation/key-hints.ts";
import { interruptionOf } from "../../src/solo/conversation/interruption.ts";
import { requestOf } from "../../src/solo/conversation/request.ts";
import { hintedCommands, SLASH_COMMANDS } from "../../src/solo/conversation/slash-commands.ts";
import type { ConversationState } from "../../src/solo/conversation/conversation-state.ts";
import { after, COMPLETED, FAILED, RUNNING, showing } from "./fixtures.ts";

const HOME = after([]);
const LIVE = showing();
const ENDED = after([{ type: "ended", session: COMPLETED }], LIVE);

/** The conversation with something typed in its input. */
const typing = (input: string, state: ConversationState = HOME): ConversationState => after([{ type: "typed", input }], state);

describe("the commands a person may be typing", () => {
  it("are every command for a slash alone, those whose name starts with what follows it, and none once the name is left", () => {
    assert.deepEqual(hintedCommands("/"), SLASH_COMMANDS);
    assert.deepEqual(
      hintedCommands("/s").map(({ name }) => name),
      ["sessions", "stop"],
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

  it("is to open a session with what was typed when no session goes on on screen: at the start, or once the one shown ended", () => {
    assert.deepEqual(requestOf(typing("  Test the returns. ")), { kind: "open", request: "Test the returns." });
    assert.deepEqual(requestOf(typing("Test the returns.", ENDED)), { kind: "open", request: "Test the returns." });
  });

  it("is to say what was typed to the session on screen while it goes on", () => {
    assert.deepEqual(requestOf(typing("Without the profile.", LIVE)), { kind: "say", session: RUNNING.id, text: "Without the profile." });
  });

  it("is the command a slash names, by its name or by the start of it when no other shares it", () => {
    assert.deepEqual(
      ["/sessions", "/new", "/help", "/quit", "/q", "/se", "/ui", " /help  "].map((input) => requestOf(typing(input))),
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
  it("is to open a session at the start, and the next one once the session on screen ended", () => {
    assert.deepEqual(hintsOf(HOME), { placeholder: "What do we test?", keys: ["Enter open a session", "/ commands", "Ctrl-C quit"] });
    assert.deepEqual(hintsOf(ENDED), { placeholder: "What do we test next?", keys: ["Enter open a session", "/ commands", "Ctrl-C quit"] });
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
