import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { ModelUnreachableError, TRACES_FOLDER, type TraceLine } from "@open-qa-stack/domain";
import { Trace } from "../src/common/trace.ts";
import { TracedPhases } from "../src/common/traced-phases.ts";
import { MAX_TRACED_LENGTH } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-trace-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const AT = new Date("2026-11-13T10:00:00.000Z");
const read = (path: string) =>
  readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TraceLine);

describe("trace, criterion 4 — the key of the model and the connection strings are in no line, and a long string is cut", () => {
  it("masks every secret in every form, cuts the strings past the limit, and keeps the others whole", () => {
    const path = Trace.pathFor(workspace, "cartography-local", AT);
    assert.equal(path, join(workspace, TRACES_FOLDER, "cartography-local-2026-11-13T10-00-00-000Z.jsonl"));
    const trace = new Trace(path, { secrets: ["", "sk-model key", "postgresql://u:p@h/db"], now: () => AT });
    trace.agent(
      "card",
      {
        type: "tool-result",
        callId: "c1",
        tool: "t",
        result: { text: "key sk-model key, url postgresql%3A%2F%2Fu%3Ap%40h%2Fdb", rows: [1, null, true], "postgresql://u:p@h/db": { "sk-model key": 1 } },
      },
      "shop-db",
    );
    trace.harness("survey", { type: "message", text: "x".repeat(MAX_TRACED_LENGTH + 5) });
    trace.harness("survey", { type: "message", text: "y".repeat(MAX_TRACED_LENGTH) });
    const [result, cut, whole] = read(path);
    assert.deepEqual(result, {
      at: AT.toISOString(),
      phase: "card",
      source: "shop-db",
      actor: "agent",
      event: {
        type: "tool-result",
        callId: "c1",
        tool: "t",
        result: { text: "key [secret], url [secret]", rows: [1, null, true], "[secret]": { "[secret]": 1 } },
      },
    });
    assert.equal(cut!.event.type === "message" && cut!.event.text, `${"x".repeat(MAX_TRACED_LENGTH)}[… 5 characters cut]`);
    assert.equal(whole!.event.type === "message" && whole!.event.text.length, MAX_TRACED_LENGTH);
  });
});

describe("the trace of an agent that fails", () => {
  it("keeps the name and the message of the runtime error, and its counters", () => {
    const path = join(workspace, "failure.jsonl");
    const seen: TraceLine[] = [];
    const trace = new Trace(path, { secrets: [], observe: (line) => seen.push(line), now: () => AT });
    const counters = { iterations: 1, actions: 0, elapsedMs: 5 };
    trace.agent("consolidation", { type: "error", error: new ModelUnreachableError("http://127.0.0.1:1/v1"), counters });
    const [line] = read(path);
    assert.ok(line!.event.type === "error");
    assert.deepEqual([line!.event.error.name, line!.event.counters, line!.source], ["ModelUnreachableError", counters, undefined]);
    assert.ok(line!.event.error.message.length > 0);
    assert.deepEqual(seen, [line]);
  });
});

describe("the phases of a run", () => {
  it("end only the phase open, and close nothing when none is", () => {
    const path = join(workspace, "phases.jsonl");
    const phases = new TracedPhases(new Trace(path, { secrets: [], now: () => AT }), "survey");
    assert.equal(phases.current, "survey");
    phases.start("card");
    phases.end("done");
    phases.close();
    assert.equal(phases.current, "card");
    phases.start("knowledge-base");
    phases.close();
    assert.deepEqual(
      read(path).map((line) => [line.phase, line.event]),
      [
        ["card", { type: "started" }],
        ["card", { type: "finished", outcome: "done" }],
        ["knowledge-base", { type: "started" }],
        ["knowledge-base", { type: "finished", outcome: "failed" }],
      ],
    );
  });
});
