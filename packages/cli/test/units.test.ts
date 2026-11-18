import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { RunEntry, RunState, TraceLine } from "@open-qa-stack/domain";
import { FileJournal, FileRunStore, followedLine, MAX_FOLLOWED_LENGTH, parseArguments, soloCommand, USAGE } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-cli-units-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
/** Runs the command as a program, and gives its exit code and outputs. */
const oqas = (...args: string[]) =>
  new Promise<{ code: number; out: string; err: string }>((resolve) =>
    execFile(process.execPath, [MAIN, ...args], { cwd: workspace, encoding: "utf8" }, (error, out, err) =>
      resolve({ code: error === null ? 0 : (error.code as number), out, err }),
    ),
  );

describe("the options of the command", () => {
  it("reads the repository, the environment, the forced cartography and the help", () => {
    assert.deepEqual(parseArguments([]), { ok: true, arguments: { force: false, follow: false, help: false, init: false } });
    assert.deepEqual(parseArguments(["--repository", "tests", "--environment", "local", "--force-cartography", "--follow", "--help"]), {
      ok: true,
      arguments: { repository: "tests", environment: "local", force: true, follow: true, help: true, init: false },
    });
  });

  it("refuses an option without its value, and an unknown option", () => {
    assert.deepEqual(parseArguments(["--repository"]), { ok: false, error: "--repository needs a value." });
    assert.deepEqual(parseArguments(["--environment", "--help"]), { ok: false, error: "--environment needs a value." });
    assert.deepEqual(parseArguments(["--push"]), { ok: false, error: "Unknown option --push; see oqas --help." });
    assert.deepEqual(parseArguments(["--brief", "tester la recherche d'un client"]), {
      ok: true,
      arguments: { brief: "tester la recherche d'un client", force: false, follow: false, help: false, init: false },
    });
    assert.deepEqual(parseArguments(["--brief", "  "]), { ok: false, error: "--brief needs a value." });
  });

  it("reads the run to resume, and refuses another identifier, or an option the run resumed keeps", () => {
    assert.deepEqual(parseArguments(["--resume", "oqas-2026-11-13T12-00-00-000Z"]), {
      ok: true,
      arguments: { resume: "oqas-2026-11-13T12-00-00-000Z", force: false, follow: false, help: false, init: false },
    });
    assert.deepEqual(parseArguments(["--resume", "../oqas"]), {
      ok: false,
      error: "--resume needs the identifier of a run, such as oqas-2026-11-13T12-00-00-000Z.",
    });
    const kept = "--resume keeps the environment and the brief of the run, and the cards it made: it takes no --environment, --brief nor --force-cartography.";
    for (const option of [["--environment", "local"], ["--brief", "Orders."], ["--force-cartography"]])
      assert.deepEqual(parseArguments(["--resume", "oqas-1", ...option]), { ok: false, error: kept });
  });

  it("are the program's: --help prints the usage, a wrong option and a missing configuration exit with 3", async () => {
    assert.deepEqual(await oqas("--help"), { code: 0, out: USAGE, err: "" });
    const wrong = await oqas("--push");
    assert.deepEqual([wrong.code, wrong.err], [3, "Unknown option --push; see oqas --help.\n"]);
    const missing = await oqas("--repository", workspace);
    assert.equal(missing.code, 3);
    assert.match(missing.err, /oqas\.json cannot be read/);
  });
});

describe("the command, called in the process", () => {
  /** Runs the command with outputs that are kept, and gives its exit code and what it wrote. */
  const called = async (argv: string[], write?: (text: string) => void) => {
    let out = "";
    let err = "";
    const code = await soloCommand(argv, {
      env: {},
      cwd: workspace,
      stdout: { write: (text) => (out += text) },
      stderr: {
        write: (text) => {
          write?.(text);
          err += text;
        },
      },
    });
    return { code, out, err };
  };

  it("prints the usage, refuses a wrong option, and stops on a missing configuration with the runner of the machine", async () => {
    assert.deepEqual(await called(["--help"]), { code: 0, out: USAGE, err: "" });
    assert.deepEqual(await called(["--push"]), { code: 3, out: "", err: "Unknown option --push; see oqas --help.\n" });
    const missing = await called([]);
    assert.equal(missing.code, 3);
    assert.match(missing.err, /oqas\.json cannot be read/);
  });

  it("exits with 5 on what is thrown, even when it is no error", async () => {
    let thrown = false;
    const stopped = await called([], () => {
      if (thrown) return;
      thrown = true;
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- what a foreign output may throw
      throw "the output is closed";
    });
    assert.equal(stopped.code, 5);
    assert.match(stopped.err, /oqas stopped on an unexpected error: the output is closed/);
  });
});

describe("the journal of a run, on the error output and in its file", () => {
  const entries: RunEntry[] = [
    { at: "2026-11-13T11:59:00.000Z", step: "configuration", event: "info", message: "Read." },
    { at: "2026-11-13T12:00:00.000Z", step: "cartography", event: "finished", message: "Done.", durationMs: 1234, modelRequests: 5 },
    { at: "2026-11-13T12:00:01.000Z", step: "design", event: "error", message: "Nothing." },
    { at: "2026-11-13T12:00:02.000Z", step: "execution", event: "info", message: "passed: a test.", durationMs: 10 },
  ];

  it("writes each entry as a line, and keeps the entries in the file of the run once asked, the earlier ones first", () => {
    const root = mkdtempSync(join(workspace, "journal-"));
    const run = { runId: "oqas-1", stateDir: ".state" };
    const lines: string[] = [];
    const journal = new FileJournal(root, (line) => lines.push(line));
    assert.equal(journal.location(run), ".state/runs/oqas-1.jsonl");
    journal.entry(entries[1]!);
    journal.entry(entries[2]!);
    assert.equal(existsSync(join(root, ".state")), false);
    journal.keep(run, entries.slice(0, 3));
    journal.entry(entries[3]!);
    assert.deepEqual(lines, ["[cartography] finished: Done. (1.2 s, 5 model requests)\n", "[design] error: Nothing.\n", "[execution] passed: a test. (0 s)\n"]);
    assert.equal(readFileSync(join(root, ".state", "runs", "oqas-1.jsonl"), "utf8"), entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
  });
});

describe("the states of the runs, in the files of the test repository", () => {
  const state = (runId: string): RunState => ({
    formatVersion: 1,
    runId,
    environment: "local",
    startedAt: "2026-11-13T12:00:00.000Z",
    durationMs: 1,
    exitCode: 5,
    steps: [],
    designed: [],
    tests: [],
    journal: `.state/runs/${runId}.jsonl`,
  });

  it("keeps a state as indented JSON beside the journal, and gives it back with where it is", async () => {
    const root = mkdtempSync(join(workspace, "store-"));
    const store = new FileRunStore(root);
    const run = { runId: "oqas-1", stateDir: ".state" };
    assert.equal(store.location(run), ".state/runs/oqas-1.json");
    const path = join(root, ".state", "runs", "oqas-1.json");
    assert.deepEqual(await store.read(run), { where: path, state: undefined });
    assert.deepEqual(await store.readAll(".state"), []);
    await store.write(run, state("oqas-1"));
    assert.equal(readFileSync(path, "utf8"), `${JSON.stringify(state("oqas-1"), null, 2)}\n`);
    assert.deepEqual(await store.read(run), { where: path, state: state("oqas-1") });
  });

  it("gives what each file of a state holds, a file that is no JSON as nothing, and passes over the other files", async () => {
    const root = mkdtempSync(join(workspace, "store-"));
    const store = new FileRunStore(root);
    await store.write({ runId: "oqas-1", stateDir: ".state" }, state("oqas-1"));
    writeFileSync(join(root, ".state", "runs", "oqas-2.json"), "{");
    writeFileSync(join(root, ".state", "runs", "oqas-1.jsonl"), "{}\n");
    assert.deepEqual(await store.readAll(".state"), [state("oqas-1"), undefined]);
    assert.deepEqual(await store.read({ runId: "oqas-2", stateDir: ".state" }), { where: join(root, ".state", "runs", "oqas-2.json"), state: undefined });
  });
});

describe("a line of the trace, as a person follows it", () => {
  const at = "2026-11-13T12:34:56.000Z";
  const agent = (event: Extract<TraceLine, { actor: "agent" }>["event"], source?: string): TraceLine => ({
    at,
    phase: "plan",
    actor: "agent",
    event,
    ...(source === undefined ? {} : { source }),
  });
  const harness = (event: Extract<TraceLine, { actor: "harness" }>["event"]): TraceLine => ({ at, phase: "write", actor: "harness", event });

  it("says when, in which phase and for which source, then what the agent did", () => {
    assert.equal(
      followedLine(agent({ type: "tool-call", callId: "1", tool: "shop_click", arguments: { target: { role: "button", name: "Search" } } }, "shop")),
      '12:34:56 plan shop -> shop_click({"target":{"role":"button","name":"Search"}})',
    );
    assert.equal(followedLine(agent({ type: "tool-result", callId: "1", tool: "shop_click", result: "One\n  order." })), "12:34:56 plan <- One order.");
    assert.equal(followedLine(agent({ type: "tool-result", callId: "1", tool: "shop_click", result: undefined })), "12:34:56 plan <- undefined");
    assert.equal(
      followedLine(agent({ type: "tool-error", callId: "1", tool: "shop_click", reason: "failed", message: "No such button." })),
      "12:34:56 plan !! shop_click (failed): No such button.",
    );
    assert.equal(followedLine(agent({ type: "text", text: "Done." })), "12:34:56 plan agent: Done.");
    assert.equal(followedLine(agent({ type: "reasoning", text: "I look first." })), "12:34:56 plan agent thinks: I look first.");
    assert.equal(
      followedLine(agent({ type: "error", error: { name: "ModelResponseError", message: "The model answered with status 500." } })),
      "12:34:56 plan !! ModelResponseError: The model answered with status 500.",
    );
    assert.equal(
      followedLine(agent({ type: "stopped", reason: { limit: "duration", counters: { iterations: 1, actions: 0, elapsedMs: 1 } } })),
      "12:34:56 plan stopped by its duration limit",
    );
  });

  it("says what the harness told the agent, and what a phase asked of the model", () => {
    assert.equal(followedLine(harness({ type: "message", text: "Write the test." })), "12:34:56 write harness: Write the test.");
    assert.equal(followedLine(harness({ type: "usage", requests: 3 })), "12:34:56 write 3 model requests");
    assert.equal(followedLine(harness({ type: "usage", requests: 3, inputTokens: 1200 })), "12:34:56 write 3 model requests");
    assert.equal(
      followedLine(harness({ type: "usage", requests: 3, inputTokens: 1200, outputTokens: 40 })),
      "12:34:56 write 3 model requests, 1200 tokens read, 0 of them from the cache, 40 written",
    );
    assert.equal(
      followedLine(harness({ type: "usage", requests: 3, inputTokens: 1200, outputTokens: 40, cachedTokens: 1000 })),
      "12:34:56 write 3 model requests, 1200 tokens read, 1000 of them from the cache, 40 written",
    );
  });

  it("cuts a long text, and leaves out what the journal prints or what says nothing to follow", () => {
    assert.equal(followedLine(agent({ type: "text", text: "x".repeat(MAX_FOLLOWED_LENGTH + 5) })), `12:34:56 plan agent: ${"x".repeat(MAX_FOLLOWED_LENGTH)}…`);
    assert.equal(followedLine(harness({ type: "journal", level: "info", message: "The plan was accepted." })), undefined);
    assert.equal(followedLine(harness({ type: "started" })), undefined);
    assert.equal(followedLine(agent({ type: "end" })), undefined);
  });
});
