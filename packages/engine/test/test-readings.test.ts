import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { UnknownCaptureError, type OqasConfig } from "@open-qa-stack/domain";
import { TestReadings } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";

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

/** The operations on a repository, once the configuration is in force. */
async function readings(root: string | undefined): Promise<TestReadings> {
  const configuration = new MemoryConfigurationStore();
  await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
  return new TestReadings(root, configuration);
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
    assert.equal(read.run, "run-2026-11-19T08-00-00-000Z");
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
    assert.deepEqual(await new TestReadings(root, new MemoryConfigurationStore()).read(SEARCH), { path: SEARCH });
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
        { name: "3", contentType: "image/png", path: "/etc/hosts" },
        { name: "4", contentType: "image/png", path: join(root, "gone.png") },
      ]),
    );
    const operations = await readings(root);
    const first = await operations.capture(SEARCH, 1);
    assert.deepEqual([first.contentType, Buffer.from(first.bytes).toString()], ["image/png", "in the report"]);
    const second = await operations.capture(SEARCH, 2);
    assert.deepEqual([second.contentType, Buffer.from(second.bytes).toString()], ["application/octet-stream", "png bytes"]);
    // A file outside the repository is never read, and a file that is gone is no capture.
    for (const step of [3, 4, 5]) await assert.rejects(operations.capture(SEARCH, step), new UnknownCaptureError(SEARCH, step));
    await assert.rejects(operations.capture("apps/shop/tests/other.spec.ts", 1), UnknownCaptureError);
  });
});
