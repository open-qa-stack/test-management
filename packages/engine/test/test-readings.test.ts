import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { UnknownCaptureError, UnknownExecutionError, type OqasConfig } from "@open-qa-stack/domain";
import { TestReadings } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";

/** A configuration whose applications are in `apps`, and whose state is in `.oqas`. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

/** The path of the test of the shop, from the root of the repository. */
const SEARCH = "apps/shop/tests/orders/search.spec.ts";

/** A report of the test of the shop, passed or failed, with the attachments given. */
function report(status: "passed" | "failed", attachments: readonly object[]): string {
  const steps = [
    { title: "1. Open the orders", duration: 20 },
    { title: "2. Search", duration: 30, ...(status === "failed" ? { error: { message: "Error: none" } } : {}) },
  ];
  return JSON.stringify({
    suites: [
      {
        title: "shop/tests/orders/search.spec.ts",
        file: "shop/tests/orders/search.spec.ts",
        specs: [
          {
            title: "Search an order",
            file: "shop/tests/orders/search.spec.ts",
            line: 3,
            tests: [
              {
                projectName: "shop",
                status: status === "passed" ? "expected" : "unexpected",
                expectedStatus: "passed",
                results: [{ status, steps, attachments }],
              },
            ],
          },
        ],
      },
    ],
  });
}

/** A test repository whose runs are those given, by the name of their folder. */
function repository(runs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-test-readings-"));
  for (const [run, text] of Object.entries(runs)) {
    mkdirSync(join(root, ".oqas", "runs", run), { recursive: true });
    writeFileSync(join(root, ".oqas", "runs", run, "report.json"), text);
  }
  // The state of a run beside its folder is no run.
  mkdirSync(join(root, ".oqas", "runs"), { recursive: true });
  writeFileSync(join(root, ".oqas", "runs", "run-2026-11-19T09-00-00-000Z.json"), "{}");
  return root;
}

/** The operations on a repository, once the configuration is in force, with the executions given kept. */
async function readings(root: string | undefined, executions = new MemoryExecutionStore()): Promise<TestReadings> {
  const configuration = new MemoryConfigurationStore();
  await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
  return new TestReadings(root, configuration, executions);
}

/** The store of the executions, keeping one of the run of a folder, at a date that is not that of its folder. */
async function keeping(run: string): Promise<MemoryExecutionStore> {
  const store = new MemoryExecutionStore();
  await store.add({ id: "e1", origin: "design", ranAt: "2026-11-19T08:00:05.000Z", report: `.oqas/runs/${run}/report.json`, results: [] });
  return store;
}

describe("a test of the repository read in steps", () => {
  it("is read from the latest run that ran it, which it names", async () => {
    const root = repository({
      "run-2026-11-19T08-00-00-000Z": report("failed", []),
      "run-2026-11-19T07-00-00-000Z": report("passed", []),
      // A later run that did not run the test, and one whose report is not one, do not count.
      "run-2026-11-19T09-00-00-000Z": JSON.stringify({ suites: [] }),
      "run-2026-11-19T10-00-00-000Z": "not a report",
    });
    // A run that left no report, such as one stopped before the runner wrote it, does not count either.
    mkdirSync(join(root, ".oqas", "runs", "run-2026-11-19T11-00-00-000Z"));
    const read = await (await readings(root)).read(SEARCH);
    assert.deepEqual([read.run, read.ranAt], ["run-2026-11-19T08-00-00-000Z", "2026-11-19T08:00:00.000Z"]);
    // A run in a folder that bears no date, one a person made, is read all the same, undated.
    const manual = repository({ manual: report("passed", []) });
    const undated = await (await readings(manual)).read(SEARCH);
    assert.deepEqual([undated.run, "ranAt" in undated], ["manual", false]);
    assert.deepEqual(
      [read.path, read.view?.id, read.view?.failedStep, read.view?.steps.map((step) => step.title)],
      [SEARCH, "shop › shop/tests/orders/search.spec.ts:3 › Search an order", 2, ["1. Open the orders", "2. Search"]],
    );
  });

  it("has no view for a test no run kept ran, nor for a path outside the folder of the applications, nor without a repository", async () => {
    const root = repository({ "run-2026-11-19T08-00-00-000Z": report("passed", []) });
    assert.deepEqual(await (await readings(root)).read("apps/shop/tests/other.spec.ts"), { path: "apps/shop/tests/other.spec.ts" });
    assert.deepEqual(await (await readings(root)).read("shop/tests/orders/search.spec.ts"), { path: "shop/tests/orders/search.spec.ts" });
    assert.deepEqual(await (await readings(mkdtempSync(join(tmpdir(), "oqas-no-runs-")))).read(SEARCH), { path: SEARCH });
    assert.deepEqual(await (await readings(undefined)).read(SEARCH), { path: SEARCH });
    assert.deepEqual(await new TestReadings(root, new MemoryConfigurationStore(), new MemoryExecutionStore()).read(SEARCH), { path: SEARCH });
  });

  it("is read from the run of an execution the instance keeps, at the date of the execution, even when a later run ran it", async () => {
    const root = repository({ "run-2026-11-19T08-00-00-000Z": report("failed", []), "run-2026-11-19T09-00-00-000Z": report("passed", []) });
    const read = await (await readings(root, await keeping("run-2026-11-19T08-00-00-000Z"))).read(SEARCH, "e1");
    assert.deepEqual([read.run, read.ranAt, read.view?.failedStep], ["run-2026-11-19T08-00-00-000Z", "2026-11-19T08:00:05.000Z", 2]);
    // An execution whose report is gone, or did not hold the test, has no view of it; one the instance does not keep is refused.
    assert.deepEqual(await (await readings(root, await keeping("run-gone"))).read(SEARCH, "e1"), { path: SEARCH });
    assert.deepEqual(await (await readings(root, await keeping("run-2026-11-19T08-00-00-000Z"))).read("apps/shop/tests/other.spec.ts", "e1"), {
      path: "apps/shop/tests/other.spec.ts",
    });
    await assert.rejects((await readings(root)).read(SEARCH, "e1"), new UnknownExecutionError("e1"));
  });
});

describe("the capture of a step of a test", () => {
  it("is the one the latest run attached under the number of the step, kept in the report or in a file of the repository", async () => {
    const root = repository({});
    const file = join(root, ".oqas", "runs", "shot.png");
    writeFileSync(file, "png bytes");
    const run = join(root, ".oqas", "runs", "run-2026-11-19T08-00-00-000Z");
    mkdirSync(run, { recursive: true });
    writeFileSync(
      join(run, "report.json"),
      report("passed", [
        { name: "1", contentType: "image/png", body: Buffer.from("in the report").toString("base64") },
        { name: "2", path: file },
      ]),
    );
    const operations = await readings(root);
    const first = await operations.capture(SEARCH, 1);
    assert.deepEqual([first.contentType, Buffer.from(first.bytes).toString()], ["image/png", "in the report"]);
    const second = await operations.capture(SEARCH, 2);
    assert.deepEqual([second.contentType, Buffer.from(second.bytes).toString()], ["application/octet-stream", "png bytes"]);
    // A step the test does not have has no capture.
    await assert.rejects(operations.capture(SEARCH, 3), new UnknownCaptureError(SEARCH, 3));
    // A file outside the repository is never read, and a file that is gone is no capture.
    writeFileSync(
      join(run, "report.json"),
      report("passed", [
        { name: "1", contentType: "image/png", path: "/etc/hosts" },
        { name: "2", contentType: "image/png", path: join(root, "gone.png") },
      ]),
    );
    for (const step of [1, 2]) await assert.rejects(operations.capture(SEARCH, step), new UnknownCaptureError(SEARCH, step));
    await assert.rejects(operations.capture("apps/shop/tests/other.spec.ts", 1), UnknownCaptureError);
  });

  it("is, at the step that failed with none of its own, the page the runner captured at the failure", async () => {
    const root = repository({});
    const shot = join(root, ".oqas", "runs", "test-failed-1.png");
    writeFileSync(shot, "failure bytes");
    const run = join(root, ".oqas", "runs", "run-2026-11-19T08-00-00-000Z");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "report.json"), report("failed", [{ name: "screenshot", contentType: "image/png", path: shot }]));
    const operations = await readings(root);
    const failed = await operations.capture(SEARCH, 2);
    assert.deepEqual([failed.contentType, Buffer.from(failed.bytes).toString()], ["image/png", "failure bytes"]);
    await assert.rejects(operations.capture(SEARCH, 1), new UnknownCaptureError(SEARCH, 1));
  });

  it("is read from the run of an execution the instance keeps, when one is named", async () => {
    const root = repository({
      "run-2026-11-19T08-00-00-000Z": report("passed", [{ name: "1", contentType: "image/png", body: Buffer.from("then").toString("base64") }]),
      "run-2026-11-19T09-00-00-000Z": report("passed", [{ name: "1", contentType: "image/png", body: Buffer.from("later").toString("base64") }]),
    });
    const operations = await readings(root, await keeping("run-2026-11-19T08-00-00-000Z"));
    assert.equal(Buffer.from((await operations.capture(SEARCH, 1, "e1")).bytes).toString(), "then");
    await assert.rejects(operations.capture(SEARCH, 1, "e2"), new UnknownExecutionError("e2"));
  });
});
