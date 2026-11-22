import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { Execution, ExecutionList, RepositoryTestList, TestReading } from "@open-qa-stack/domain";
import { chain, Terminal } from "./support/terminal.ts";

const BRIEF = ["--environment", "local", "--brief", "Test the listing of the orders."];

/** The first test the design of the chain writes, from the root of the test repository. */
const FIRST = "apps/shop/tests/orders/listing/test-1.spec.ts";

/** A capture, as small as a capture can be. */
const PNG = Buffer.from("a capture");

let terminal: Terminal;
afterEach(() => terminal.close());

/**
 * Keeps a run later than the session's, which ran the first test in two steps, the second of which failed: the
 * capture of the second step in the report, and a trace written in the test repository.
 */
function keptRun(root: string): void {
  const folder = join(root, ".oqas", "runs", "run-2999-01-01T00-00-00-000Z");
  mkdirSync(folder, { recursive: true });
  const trace = join(folder, "trace.zip");
  writeFileSync(trace, "a trace");
  const steps = [
    { title: "1. Open the orders", duration: 20, steps: [{ title: "Click the menu", duration: 5 }] },
    { title: "2. Search", duration: 30, error: { message: "Error: none" } },
  ];
  const attachments = [
    { name: "2", contentType: "image/png", body: PNG.toString("base64") },
    { name: "trace", contentType: "application/zip", path: trace },
  ];
  const file = FIRST.slice("apps/".length);
  const spec = {
    title: "test-1",
    file,
    line: 3,
    tests: [{ projectName: "shop", status: "unexpected", expectedStatus: "passed", results: [{ status: "failed", steps, attachments }] }],
  };
  writeFileSync(join(folder, "report.json"), JSON.stringify({ suites: [{ title: file, file, specs: [spec] }] }));
}

describe("oqas tests and oqas executions", () => {
  it("list the tests and the executions, read an execution and a test, and what came of its file, as lines or as JSON", async () => {
    terminal = await Terminal.open(chain());
    await terminal.oqas(["executions"]).then(({ out }) => assert.equal(out, "No execution of tests to list.\n"));
    await terminal.oqas(BRIEF);

    const tests = await terminal.oqas(["tests"]);
    assert.equal(tests.code, 0);
    assert.match(tests.out, new RegExp(`^${FIRST} › test-1 {2}\\[level functional, domain orders, feature listing, case nominal\\]\\n`));
    assert.equal((JSON.parse((await terminal.oqas(["tests", "--output", "json"])).out) as RepositoryTestList).items.length, 3);

    const page = await terminal.oqas(["executions"]);
    const [id = ""] = page.out.split(" ");
    assert.match(page.out, new RegExp(`^${id} {2}design, session session-\\S+ {2}\\S+Z {2}3 of 3 tests passed\\nExecutions 1 to 1 of 1\\.\\n$`));
    assert.equal((JSON.parse((await terminal.oqas(["executions", "--outcome", "passing", "--output", "json"])).out) as ExecutionList).total, 1);
    assert.equal((await terminal.oqas(["executions", "--outcome", "failing"])).out, "No execution of tests to list.\n");
    assert.equal((await terminal.oqas(["executions", "--before", id])).out, "No execution of tests to list.\n");

    const shown = await terminal.oqas(["executions", "show", id]);
    assert.match(shown.out, new RegExp(`^${id} .* 3 of 3 tests passed, at the commit [0-9a-f]{40}\\.\\npassed {2}${FIRST} › the test\\n`));
    assert.equal((JSON.parse((await terminal.oqas(["executions", "show", id, "--output", "json"])).out) as Execution).results.length, 3);

    assert.match((await terminal.oqas(["tests", "executions", FIRST])).out, new RegExp(`^${id} {2}design, session \\S+ {2}\\S+Z {2}passed {2}the test\\n$`));
    assert.equal((await terminal.oqas(["tests", "executions", "nowhere.spec.ts"])).out, "No execution the instance keeps ran nowhere.spec.ts.\n");
    assert.equal((await terminal.oqas(["tests", "versions", "nowhere.spec.ts"])).out, "The instance keeps no version of nowhere.spec.ts.\n");
    assert.equal((await terminal.oqas(["tests", "read", "nowhere.spec.ts"])).out, "nowhere.spec.ts: no run the instance keeps ran it.\n");
  });

  it("read a test in steps from the latest run that ran it, and write its trace and the capture of a step to files", async () => {
    terminal = await Terminal.open([]);
    assert.equal((await terminal.oqas(["tests"])).out, "The test repository holds no test yet.\n");
    keptRun(terminal.root);
    const read = await terminal.oqas(["tests", "read", FIRST]);
    assert.deepEqual(read.out.split("\n"), [
      `${FIRST}, as the run run-2999-01-01T00-00-00-000Z of 2999-01-01T00:00:00.000Z ran it: failed.`,
      "  ✓ 1. Open the orders · 20 ms",
      "    ✓ Click the menu · 5 ms",
      "  ✗ 2. Search · 30 ms",
      "A trace of it is kept.",
      "",
    ]);
    assert.equal((JSON.parse((await terminal.oqas(["tests", "read", FIRST, "--output", "json"])).out) as TestReading).traced, true);

    const traced = await terminal.oqas(["tests", "trace", FIRST, join(terminal.root, "trace.zip")]);
    assert.equal(traced.code, 0, traced.err);
    assert.match(traced.out, /^The trace of .* is written to .*trace\.zip: npx playwright show-trace opens it\.\n$/);
    assert.equal(readFileSync(join(terminal.root, "trace.zip"), "utf8"), "a trace");

    const captured = await terminal.oqas(["tests", "capture", FIRST, "2", join(terminal.root, "step-2.png")]);
    assert.match(captured.out, /^The capture of step 2 of .* is written to .*step-2\.png \(image\/png\)\.\n$/);
    assert.deepEqual(readFileSync(join(terminal.root, "step-2.png")), PNG);
  });

  it("are refused with 3 for what the instance does not keep, and for words they do not take, with what to give", async () => {
    terminal = await Terminal.open([]);
    const refused = async (argv: readonly string[], err: string): Promise<void> =>
      assert.deepEqual(await terminal.oqas(argv), { code: 3, out: "", err: `${err}\n` });
    await refused(["executions", "show", "nope"], "The instance keeps no execution nope.");
    await refused(["tests", "trace", FIRST, "trace.zip"], `The run read of ${FIRST} kept no trace of it that can be read.`);
    await refused(["tests", "capture", FIRST, "1", "step.png"], `The run read of ${FIRST} attached no capture for its step 1.`);
    await refused(
      ["tests", "bogus", FIRST],
      "oqas tests takes nothing, read, executions or versions then a test, trace then a test and a file, or capture then a test, a step and a file.",
    );
    await refused(["tests", "capture", FIRST, "first", "step.png"], "oqas tests capture needs the number of a step, from 1.");
    await refused(
      ["tests", "read"],
      "oqas tests takes nothing, read, executions or versions then a test, trace then a test and a file, or capture then a test, a step and a file.",
    );
    await refused(["tests", "--follow"], "oqas tests acts on the tests of the test repository: it takes no --brief, --environment nor --follow.");
    await refused(["executions", "show"], "oqas executions takes nothing, to list them, or show then an execution.");
    await refused(["executions", "--follow"], "oqas executions acts on the executions of tests: it takes no --brief, --environment nor --follow.");
    await refused(["executions", "--outcome", "red"], "--outcome needs failing or passing.");
    await refused(["tests", "--before", "e1"], "--outcome and --before choose the executions oqas executions lists: they go with it alone.");
  });
});
