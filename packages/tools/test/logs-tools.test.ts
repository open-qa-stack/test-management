import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import type { ContainerEngine, ReachableKnowledge, ToolDefinition } from "@open-qa-stack/domain";
import { ContainerLogs } from "../src/logs/container-logs.ts";
import { lineInstant, parseInstant } from "../src/logs/log-instant.ts";
import { MAX_LOG_CHARACTERS, MAX_LOG_LINE_LENGTH } from "../src/logs/log-reading.ts";
import { DEFAULT_LOG_LINES } from "../src/logs/logs-tools.ts";
import { knowledgeTools, type KnowledgeAccess } from "../src/index.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
const attachments = [{ application: "policy-management" }];
const FILE: ReachableKnowledge = { id: "policy-logs", type: "logs", path: "logs/service.log", attachments };
const CONTAINER: ReachableKnowledge = { id: "policy-backend", type: "logs", container: "policy-backend", engine: "podman", attachments };
const TASK_START = new Date("2026-11-13T10:05:00.000Z");
const PASSWORD = "s3cr3t pass/word";
const CONNECTION = "postgresql://policy:pw@127.0.0.1:5432/policy";

interface Reading {
  readonly since: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
}

let workspace: string;
let doubles: string;
let path: string | undefined;

/** The one tool of a log source. */
function readLogs(source: ReachableKnowledge, access: Partial<KnowledgeAccess> = {}): ToolDefinition {
  const tools = knowledgeTools([source], { repositoryRoot: FIXTURES, env: {}, taskStart: TASK_START, ...access });
  assert.equal(tools.length, 1);
  return tools[0]!;
}

async function read(tool: ToolDefinition, args: Record<string, unknown> = {}): Promise<Reading> {
  return (await tool.execute(args)) as Reading;
}

/** Puts on the path a double of an engine: a shell script that records its arguments and environment, then runs `body`. */
function engine(name: ContainerEngine, body: string): void {
  const script = join(doubles, name);
  writeFileSync(script, `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${join(workspace, "args")}"\nenv > "${join(workspace, "env")}"\n${body}\n`);
  chmodSync(script, 0o755);
}

const recordedArgs = () => readFileSync(join(workspace, "args"), "utf8").split("\n").slice(0, -1);

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "oqas-logs-"));
  doubles = join(workspace, "bin");
  mkdirSync(doubles);
  path = process.env["PATH"];
  process.env["PATH"] = `${doubles}:${path}`;
});

beforeEach(() => {
  rmSync(join(doubles, "podman"), { force: true });
  rmSync(join(doubles, "docker"), { force: true });
});

afterAll(() => {
  process.env["PATH"] = path;
  rmSync(workspace, { recursive: true, force: true });
});

describe("logs criterion 1 — a declared log file or container brings its tool", () => {
  it("names the tool after the source, and counts it as no browser action", () => {
    for (const source of [FILE, CONTAINER]) {
      const tool = readLogs(source);
      assert.equal(tool.name, `${source.id.replaceAll("-", "_")}_read_logs`);
      assert.notEqual(tool.browserAction, true);
    }
  });
});

describe("logs criterion 2 — the tool returns the lines written from the instant asked, and only them, bounded", () => {
  it("returns the lines from the instant, with the lines of a stack trace, and none before", async () => {
    const reading = await read(readLogs(FILE), { since: "2026-11-13T10:05:00Z" });
    assert.equal(reading.since, "2026-11-13T10:05:00.000Z");
    assert.deepEqual(reading.lines, readFileSync(join(FIXTURES, "logs/service.log"), "utf8").split("\n").slice(3, -1));
    assert.equal(reading.truncated, false);
  });

  it("reads from the start of the task when no instant is given", async () => {
    const reading = await read(readLogs(FILE));
    assert.equal(reading.since, TASK_START.toISOString());
    assert.match(reading.lines[0]!, /Refused policy/);
  });

  it("reads from when the tools were made when no task start is given", async () => {
    const made = Date.now();
    const later = new Date(made + 60_000).toISOString();
    writeFileSync(join(workspace, "now.log"), `2000-01-01T00:00:00Z before the task\n${later} during the task\n`);
    const tools = knowledgeTools([{ ...FILE, path: join(workspace, "now.log") }], { repositoryRoot: FIXTURES, env: {} });
    const reading = await read(tools[0]!);
    assert.ok(Date.parse(reading.since) >= made);
    assert.deepEqual(reading.lines, [`${later} during the task`]);
  });

  it("keeps the lines that contain the filter, ignoring case", async () => {
    const reading = await read(readLogs(FILE), { since: "2026-11-13T10:00:00Z", filter: "POLICYcontroller" });
    assert.deepEqual(
      reading.lines.map((line) => line.slice(0, 19)),
      ["2026-11-13T10:04:59", "2026-11-13T10:05:00", "2026-11-13 11:06:00"],
    );
  });

  it("stops at the number of lines asked, and says lines were left out", async () => {
    const reading = await read(readLogs(FILE), { since: "2026-11-13T10:05:00Z", limit: 2 });
    assert.equal(reading.lines.length, 2);
    assert.equal(reading.truncated, true);
  });

  it(`returns ${DEFAULT_LOG_LINES} lines by default, cuts long lines and stops at ${MAX_LOG_CHARACTERS} characters`, async () => {
    const short = Array.from({ length: DEFAULT_LOG_LINES + 10 }, (_, i) => `2026-11-13T10:10:00Z line ${i}`);
    const long = Array.from({ length: 20 }, (_, i) => `2026-11-13T10:20:00Z ${String(i).padEnd(MAX_LOG_LINE_LENGTH + 50, "x")}`);
    writeFileSync(join(workspace, "big.log"), [...short, ...long].join("\n"));
    const tool = readLogs({ ...FILE, path: join(workspace, "big.log") });
    const first = await read(tool, { since: "2026-11-13T10:10:00Z" });
    assert.deepEqual([first.lines.length, first.truncated], [DEFAULT_LOG_LINES, true]);
    const cut = await read(tool, { since: "2026-11-13T10:20:00Z", limit: 500 });
    assert.ok(cut.lines.every((line) => line.length === MAX_LOG_LINE_LENGTH + 1 && line.endsWith("…")));
    assert.equal(cut.lines.length, Math.floor(MAX_LOG_CHARACTERS / (MAX_LOG_LINE_LENGTH + 1)));
    assert.equal(cut.truncated, true);
  });

  it("reads the instants engines and loggers write, offsets and local time included", () => {
    assert.equal(lineInstant("2026-11-13T10:05:00.123456789Z text"), Date.parse("2026-11-13T10:05:00.123Z"));
    assert.equal(lineInstant("[2026-11-13 11:05:00,500+01:00] text"), Date.parse("2026-11-13T10:05:00.500Z"));
    assert.equal(lineInstant("2026-11-13T11:05:00+0100 text"), Date.parse("2026-11-13T10:05:00.999Z"));
    assert.equal(lineInstant("2026-11-13T10:05:00.5Z text"), Date.parse("2026-11-13T10:05:00.599Z"));
    assert.equal(lineInstant("2026-11-13 10:05 text"), new Date(2026, 10, 13, 10, 5, 59, 999).getTime());
    assert.equal(lineInstant("2026-13-13T10:05:00Z text"), undefined);
    assert.equal(lineInstant("at o.e.policy.Period"), undefined);
  });

  it("keeps a line stamped to the second from any instant within that second, and removes colour escapes", async () => {
    writeFileSync(join(workspace, "seconds.log"), "2026-11-13T09:09:20+01:00 \u001b[34mINFO\u001b[0;39m connected\n");
    const tool = readLogs({ ...FILE, path: join(workspace, "seconds.log") });
    assert.deepEqual((await read(tool, { since: "2026-11-13T08:09:20.900Z" })).lines, ["2026-11-13T09:09:20+01:00 INFO connected"]);
    assert.deepEqual((await read(tool, { since: "2026-11-13T08:09:21Z" })).lines, []);
  });

  it("refuses an instant that is not a date and a time, with an error the agent can read", async () => {
    assert.equal(parseInstant("2026-11-13T11:05:00+01:00"), Date.parse("2026-11-13T10:05:00Z"));
    for (const since of ["1", "yesterday", "2026-11-13", "2026-11-13T10:05:00Z; rm -rf /"]) {
      await assert.rejects(readLogs(FILE).execute({ since }), { message: `${JSON.stringify(since)} is not a date and a time, such as 2026-11-13T10:15:00Z.` });
    }
  });
});

describe("logs criterion 3 — a container is read by a fixed command, without a shell, that receives no text of the agent", () => {
  it("runs the engine logs command with the instant as its own argument, and filters the lines itself", async () => {
    engine(
      "podman",
      [
        `echo "2026-11-13T10:04:00.000000000Z before"`,
        `echo "2026-11-13T10:05:01.000000000Z out first"`,
        `echo "2026-11-13T10:05:03.000000000Z out \\$(touch ${join(workspace, "ran")})"`,
        `echo "no timestamp" >&2`,
        `echo "2026-11-13T10:05:02.000000000Z err second" >&2`,
      ].join("\n"),
    );
    process.env["OQAS_TEST_SECRET_VARIABLE"] = "kept-from-the-engine";
    try {
      const filter = `$(touch ${join(workspace, "ran")}); "' --help`;
      const reading = await read(readLogs(CONTAINER), { since: "2026-11-13T11:05:00+01:00", filter: "o" });
      assert.deepEqual(recordedArgs(), ["logs", "--timestamps", "--since", "2026-11-13T10:05:00.000Z", "--", "policy-backend"]);
      assert.deepEqual(reading.lines, [
        "2026-11-13T10:05:01.000000000Z out first",
        "2026-11-13T10:05:02.000000000Z err second",
        `2026-11-13T10:05:03.000000000Z out $(touch ${join(workspace, "ran")})`,
      ]);
      await read(readLogs(CONTAINER), { filter });
      assert.deepEqual(recordedArgs(), ["logs", "--timestamps", "--since", TASK_START.toISOString(), "--", "policy-backend"]);
      assert.equal(existsSync(join(workspace, "ran")), false);
      const env = readFileSync(join(workspace, "env"), "utf8");
      assert.doesNotMatch(env, /OQAS_TEST_SECRET_VARIABLE/);
      assert.match(env, /^PATH=/m);
    } finally {
      delete process.env["OQAS_TEST_SECRET_VARIABLE"];
    }
  });

  it("runs the engine the source declares", async () => {
    engine("docker", `echo "2026-11-13T10:06:00Z from docker"`);
    const reading = await read(readLogs({ ...CONTAINER, engine: "docker" }));
    assert.deepEqual(reading.lines, ["2026-11-13T10:06:00Z from docker"]);
  });

  it("says lines were left out when the engine gives more than it may read", async () => {
    engine("podman", `yes "2026-11-13T10:06:00Z padding the output to pass ten megabytes" | head -c 11000000`);
    const reading = await read(readLogs(CONTAINER), { filter: "no line holds this" });
    assert.deepEqual(reading, { since: TASK_START.toISOString(), lines: [], truncated: true });
  });
});

describe("logs criterion 4 — a value of a declared variable never appears in the lines returned", () => {
  const secrets = [PASSWORD, CONNECTION];

  it("masks the values in every form, and the filter cannot find them", async () => {
    const lines = [
      `2026-11-13T10:06:00Z login with ${PASSWORD}`,
      `2026-11-13T10:06:01Z {"password":${JSON.stringify(PASSWORD)}}`,
      `2026-11-13T10:06:02Z GET /login?password=${encodeURIComponent(PASSWORD)}`,
      `2026-11-13T10:06:03Z connecting to ${CONNECTION}`,
    ];
    writeFileSync(join(workspace, "secret.log"), lines.join("\n"));
    const tool = readLogs({ ...FILE, path: join(workspace, "secret.log") }, { secrets });
    const reading = await read(tool);
    assert.equal(reading.lines.length, 4);
    for (const line of reading.lines) {
      assert.match(line, /\[secret\]/);
      assert.ok(!line.includes("s3cr3t") && !line.includes("policy:pw"), line);
    }
    assert.deepEqual((await read(tool, { filter: "s3cr3t" })).lines, []);
  });

  it("masks them in the error of an engine too", async () => {
    engine("podman", `echo "Error: cannot connect to ${CONNECTION}" >&2; exit 125`);
    await assert.rejects(readLogs(CONTAINER, { secrets }).execute({}), {
      message: "podman cannot read the logs of policy-backend: Error: cannot connect to [secret]",
    });
  });
});

describe("logs criterion 5 — a source that cannot be reached is a tool error the agent can read", () => {
  it("names a missing file", async () => {
    await assert.rejects(readLogs({ ...FILE, path: "logs/missing.log" }).execute({}), { message: "The log file logs/missing.log cannot be read: ENOENT." });
  });

  it("gives the reason of an engine that cannot read the container", async () => {
    engine("podman", `echo "Error: no container with name or ID \\"policy-backend\\" found: no such container" >&2; echo "more" >&2; exit 125`);
    await assert.rejects(readLogs(CONTAINER).execute({}), {
      message: 'podman cannot read the logs of policy-backend: Error: no container with name or ID "policy-backend" found: no such container',
    });
  });

  it("says when the engine is not installed", async () => {
    process.env["PATH"] = doubles;
    try {
      await assert.rejects(readLogs({ ...CONTAINER, engine: "docker" }).execute({}), { message: "docker cannot be run: ENOENT." });
    } finally {
      process.env["PATH"] = `${doubles}:${path}`;
    }
  });

  it("stops an engine that does not answer in time", async () => {
    engine("podman", "sleep 5");
    await assert.rejects(new ContainerLogs("podman", "policy-backend", 100).lines(0), { message: "podman logs ran out of time." });
  });
});
