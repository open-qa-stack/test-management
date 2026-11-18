import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseArguments, USAGE, type Command } from "../src/index.ts";

/** The arguments as they are read when nothing but a command is given. */
const read = (command: Command, more: object = {}) => ({ ok: true, arguments: { output: "text", follow: false, command, ...more } });

const refused = (error: string) => ({ ok: false, error });

const INIT_ALONE = "--init writes the files of the test repository and runs nothing: it takes --repository alone.";

describe("the arguments of the command", () => {
  it("open a session with a brief, in an environment when one is named, followed and printed as asked", () => {
    assert.deepEqual(parseArguments(["--brief", "tester la recherche d'un client"]), read({ name: "run", brief: "tester la recherche d'un client" }));
    assert.deepEqual(
      parseArguments(["--repository", "tests", "--environment", "local", "--brief", "Orders.", "--follow", "--output", "json", "--no-input"]),
      read({ name: "run", brief: "Orders.", environment: "local" }, { repository: "tests", follow: true, output: "json" }),
    );
  });

  it("name a command on the sessions that exist, with the words it takes", () => {
    assert.deepEqual(parseArguments(["sessions"]), read({ name: "sessions" }));
    assert.deepEqual(parseArguments(["show", "9f3a1c2b", "--follow"]), read({ name: "show", session: "9f3a1c2b" }, { follow: true }));
    assert.deepEqual(parseArguments(["--output", "json", "attach", "9f3a1c2b"]), read({ name: "attach", session: "9f3a1c2b" }, { output: "json" }));
    assert.deepEqual(
      parseArguments(["say", "9f3a1c2b", "Only what a customer sees."]),
      read({ name: "say", session: "9f3a1c2b", text: "Only what a customer sees." }),
    );
    assert.deepEqual(parseArguments(["stop", "9f3a1c2b", "--repository", "tests"]), read({ name: "stop", session: "9f3a1c2b" }, { repository: "tests" }));
  });

  it("ask for the usage whatever else they hold, and for an initialisation with the repository alone", () => {
    assert.deepEqual(parseArguments(["--help"]), read({ name: "help" }));
    assert.deepEqual(parseArguments(["stop", "--brief", "Orders.", "--help"]), read({ name: "help" }));
    assert.deepEqual(parseArguments(["--repository", "tests", "--init"]), read({ name: "init" }, { repository: "tests" }));
    for (const other of [["--brief", "Test the orders."], ["--environment", "local"], ["--follow"], ["--output", "json"], ["sessions"]])
      assert.deepEqual(parseArguments(["--init", ...other]), refused(INIT_ALONE), other.join(" "));
  });

  it("are refused when an option lacks its value, is not known, or names no way to print", () => {
    assert.deepEqual(parseArguments(["--repository"]), refused("--repository needs a value."));
    assert.deepEqual(parseArguments(["--environment", "--help"]), refused("--environment needs a value."));
    assert.deepEqual(parseArguments(["--brief", "  "]), refused("--brief needs a value."));
    assert.deepEqual(parseArguments(["--push"]), refused("Unknown option --push; see oqas --help."));
    assert.deepEqual(parseArguments(["--brief", "Orders.", "--output", "yaml"]), refused("--output needs text or json."));
  });

  it("are refused when they say neither what to test nor what to do, or name a command that is none", () => {
    assert.deepEqual(parseArguments([]), refused("Say what to test with --brief, or name a command; see oqas --help."));
    assert.deepEqual(parseArguments(["--environment", "local"]), refused("Say what to test with --brief, or name a command; see oqas --help."));
    assert.deepEqual(parseArguments(["resume", "9f3a1c2b"]), refused("Unknown command resume; see oqas --help."));
    assert.deepEqual(parseArguments(["toString"]), refused("Unknown command toString; see oqas --help."));
  });

  it("are refused when a command on a session is given a brief, the wrong words, or a thread to follow it does not print", () => {
    assert.deepEqual(
      parseArguments(["show", "9f3a1c2b", "--brief", "Orders."]),
      refused("oqas show acts on a session that exists: it takes no --brief nor --environment."),
    );
    assert.deepEqual(
      parseArguments(["sessions", "--environment", "local"]),
      refused("oqas sessions acts on a session that exists: it takes no --brief nor --environment."),
    );
    assert.deepEqual(parseArguments(["sessions", "9f3a1c2b"]), refused("oqas sessions takes no word after it."));
    assert.deepEqual(parseArguments(["show"]), refused("oqas show takes <session>."));
    assert.deepEqual(parseArguments(["say", "9f3a1c2b"]), refused("oqas say takes <session> then <text>."));
    assert.deepEqual(parseArguments(["stop", "9f3a1c2b", "now"]), refused("oqas stop takes <session>."));
    for (const command of [["sessions"], ["say", "9f3a1c2b", "Go on."], ["stop", "9f3a1c2b"]])
      assert.deepEqual(parseArguments([...command, "--follow"]), refused(`oqas ${command[0]} prints no thread: it takes no --follow.`));
  });

  it("are told by the usage: every command, every option, and the exit codes", () => {
    for (const word of ["sessions", "show <session>", "attach <session>", "say <session> <text>", "stop <session>"])
      assert.ok(USAGE.includes(`  ${word} `), word);
    for (const option of ["--repository", "--environment", "--brief", "--follow", "--output", "--no-input", "--init", "--help"])
      assert.ok(USAGE.includes(`  ${option}`), option);
    assert.match(USAGE, /Exit codes of a session followed to its end: 0 every test passed, 1 a test failed/);
  });
});
