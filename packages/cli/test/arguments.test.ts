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

  it("serve the console on this machine and the port of oqas, or where they say, with the repository and nothing else", () => {
    assert.deepEqual(parseArguments(["--ui"]), read({ name: "ui", host: "127.0.0.1", port: 6727 }));
    assert.deepEqual(
      parseArguments(["--repository", "tests", "--ui", "--host", "0.0.0.0", "--port", "0", "--no-input"]),
      read({ name: "ui", host: "0.0.0.0", port: 0 }, { repository: "tests" }),
    );
    assert.deepEqual(parseArguments(["--ui", "--port", "65535"]), read({ name: "ui", host: "127.0.0.1", port: 65535 }));
    assert.deepEqual(parseArguments(["--ui", "--brief", "Orders.", "--help"]), read({ name: "help" }));
    const alone = "--ui serves the console, where the sessions are opened and followed: it takes --repository, --host and --port alone.";
    for (const other of [["--brief", "Test the orders."], ["--environment", "local"], ["--follow"], ["--output", "json"], ["sessions"], ["--init"]])
      assert.deepEqual(parseArguments(["--ui", ...other]), refused(alone), other.join(" "));
    for (const port of ["65536", "-1", "http", "80.5", "123456"])
      assert.deepEqual(parseArguments(["--ui", "--port", port]), refused("--port needs an integer from 0 to 65535."), port);
    const elsewhere = "--host and --port say where --ui listens: they go with it alone.";
    assert.deepEqual(parseArguments(["sessions", "--port", "8080"]), refused(elsewhere));
    assert.deepEqual(parseArguments(["--brief", "Orders.", "--host", "0.0.0.0"]), refused(elsewhere));
    assert.deepEqual(parseArguments(["--init", "--port", "8080"]), refused(elsewhere));
    assert.deepEqual(parseArguments(["--help", "--port", "8080"]), read({ name: "help" }));
  });

  it("are refused when an option lacks its value, is not known, or names no way to print", () => {
    assert.deepEqual(parseArguments(["--repository"]), refused("--repository needs a value."));
    assert.deepEqual(parseArguments(["--environment", "--help"]), refused("--environment needs a value."));
    assert.deepEqual(parseArguments(["--brief", "  "]), refused("--brief needs a value."));
    assert.deepEqual(parseArguments(["--push"]), refused("Unknown option --push; see oqas --help."));
    assert.deepEqual(parseArguments(["--brief", "Orders.", "--output", "yaml"]), refused("--output needs text or json."));
  });

  it("open the conversation when they name nothing to do, in the repository and against the environment they give", () => {
    assert.deepEqual(parseArguments([]), { ok: true, arguments: { output: "text", follow: false, command: { name: "converse" } } });
    assert.deepEqual(parseArguments(["--repository", "tests", "--environment", "local"]), {
      ok: true,
      arguments: { repository: "tests", output: "text", follow: false, command: { name: "converse", environment: "local" } },
    });
  });

  it("are refused when they name nothing to do and the conversation may not be opened: nothing is to be asked, or lines are to be printed", () => {
    for (const argv of [["--no-input"], ["--follow"], ["--output", "json"], ["--output", "text"], ["--environment", "local", "--no-input"]])
      assert.deepEqual(parseArguments(argv), refused("Say what to test with --brief, or name a command; see oqas --help."), argv.join(" "));
  });

  it("are refused when they name a command that is none", () => {
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
    assert.match(USAGE, /^Usage: oqas \[--repository <folder>\] \[--environment <name>\]\n/);
    assert.match(
      USAGE,
      /Exit codes of a session followed to its end, and of the conversation for the last session it opened: 0 every test passed, 1 a test failed/,
    );
  });

  it("test the connection to the model, or set it with the GitHub account or a provider, its key and its model", () => {
    assert.deepEqual(parseArguments(["model", "status", "--output", "json"]), read({ name: "model", action: "status" }, { output: "json" }));
    assert.deepEqual(
      parseArguments(["model", "set", "--github", "--model", "gpt-5"]),
      read({ name: "model", action: "set", connection: { github: true, model: "gpt-5" } }),
    );
    assert.deepEqual(
      parseArguments(["model", "set", "--provider", "OpenAI", "--key-env", "MY_KEY", "--model", "gpt-4.1"]),
      read({ name: "model", action: "set", connection: { github: false, provider: "OpenAI", keyEnv: "MY_KEY", model: "gpt-4.1" } }),
    );
    assert.deepEqual(
      parseArguments(["model", "set", "--provider", "http://localhost:1234/v1", "--model", "local"]),
      read({ name: "model", action: "set", connection: { github: false, provider: "http://localhost:1234/v1", model: "local" } }),
    );
  });

  it("refuse a connection to the model told by halves, or told to another command", () => {
    const either =
      "oqas model set takes --github, for the GitHub account of this machine, or --provider with the name of a provider or the address of its server.";
    assert.deepEqual(parseArguments(["model"]), refused("oqas model takes status or set."));
    assert.deepEqual(parseArguments(["model", "status", "now"]), refused("oqas model takes status or set."));
    assert.deepEqual(parseArguments(["model", "set", "--model", "m"]), refused(either));
    assert.deepEqual(parseArguments(["model", "set", "--github", "--provider", "OpenAI", "--model", "m"]), refused(either));
    assert.deepEqual(
      parseArguments(["model", "set", "--github", "--key-env", "K", "--model", "m"]),
      refused("--key-env names the variable of the key of a provider: the GitHub account takes none."),
    );
    assert.deepEqual(
      parseArguments(["model", "set", "--github"]),
      refused("oqas model set needs --model, the model to use: oqas model status lists those the connection offers."),
    );
    assert.deepEqual(
      parseArguments(["model", "status", "--follow"]),
      refused("oqas model acts on the connection to the model: it takes no --brief, --environment nor --follow."),
    );
    const alone = "--github, --provider, --key-env and --model set the connection to the model: they go with oqas model set alone.";
    for (const other of [
      ["model", "status", "--github"],
      ["sessions", "--model", "m"],
      ["--brief", "Orders.", "--provider", "OpenAI"],
      ["--init", "--key-env", "K"],
    ])
      assert.deepEqual(parseArguments(other), refused(alone), other.join(" "));
    assert.deepEqual(parseArguments(["--help", "--github"]), read({ name: "help" }));
  });
});
