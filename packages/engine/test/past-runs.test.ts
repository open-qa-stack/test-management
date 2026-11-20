import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { OqasConfig } from "@open-qa-stack/domain";
import { PastRuns } from "../src/index.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";

/** A configuration whose applications are in `apps`, and whose state is in `.oqas`. */
const DOCUMENT = {
  formatVersion: 1,
  applications: [{ id: "shop", name: "Shop", type: "api", authentication: { method: "none" }, environments: [{ name: "local" }] }],
  model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" },
} as OqasConfig;

/** A report of one test of the shop, with the status the runner gave it. */
const report = (status: string) =>
  JSON.stringify({
    suites: [
      {
        title: "shop/search.spec.ts",
        file: "shop/search.spec.ts",
        specs: [
          {
            title: "Search an order",
            file: "shop/search.spec.ts",
            line: 3,
            tests: [{ projectName: "shop", status, expectedStatus: "passed", results: [{ status: "passed", duration: 80 }] }],
          },
        ],
      },
    ],
  });

/** A test repository whose run folders hold what is given, by their names: a report, or no file at all. */
function repository(runs: Readonly<Record<string, string | undefined>>): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-past-runs-"));
  for (const [run, text] of Object.entries(runs)) {
    mkdirSync(join(root, ".oqas", "runs", run), { recursive: true });
    if (text !== undefined) writeFileSync(join(root, ".oqas", "runs", run, "report.json"), text);
  }
  // The state of a run beside its folder is no run.
  writeFileSync(join(root, ".oqas", "runs", "run-2026-11-19T09-00-00-000Z.json"), "{}");
  return root;
}

/** The revision in force of a repository whose configuration was read from its file. */
async function inForce(): Promise<MemoryConfigurationStore> {
  const configuration = new MemoryConfigurationStore();
  await configuration.record({ origin: "file", fileDigest: "a1", document: DOCUMENT }, 0);
  return configuration;
}

describe("the runs of the test repository before the instance kept its executions", () => {
  it("are taken the earliest first, dated by their folders, without a session nor a version, and once only", async () => {
    const root = repository({
      "run-2026-11-19T08-00-00-000Z": report("unexpected"),
      "run-2026-11-18T22-15-30-250Z": report("expected"),
      // A run that left no report, one whose report is no report, and a folder that is no run are not taken.
      "run-2026-11-19T09-00-00-000Z": undefined,
      "run-2026-11-19T10-00-00-000Z": "not a report",
      trials: report("expected"),
    });
    const store = new MemoryExecutionStore();
    const past = new PastRuns(root, await inForce(), store);
    assert.equal(await past.take(), 2);
    const result = (verdict: string) => ({ path: "apps/shop/search.spec.ts", title: "Search an order", project: "shop", verdict, durationMs: 80 });
    assert.deepEqual(store.all(), [
      {
        id: "run-2026-11-19T08-00-00-000Z",
        origin: "design",
        ranAt: "2026-11-19T08:00:00.000Z",
        report: ".oqas/runs/run-2026-11-19T08-00-00-000Z/report.json",
        results: [result("failed")],
      },
      {
        id: "run-2026-11-18T22-15-30-250Z",
        origin: "design",
        ranAt: "2026-11-18T22:15:30.250Z",
        report: ".oqas/runs/run-2026-11-18T22-15-30-250Z/report.json",
        results: [result("passed")],
      },
    ]);
    assert.equal(await past.take(), 0);
    assert.equal(store.all().length, 2);
  });

  it("are none for a host without a test repository, before a revision is in force, or when the repository ran none", async () => {
    const store = new MemoryExecutionStore();
    assert.equal(await new PastRuns(undefined, await inForce(), store).take(), 0);
    assert.equal(await new PastRuns(repository({ "run-2026-11-19T08-00-00-000Z": report("expected") }), new MemoryConfigurationStore(), store).take(), 0);
    assert.equal(await new PastRuns(mkdtempSync(join(tmpdir(), "oqas-past-runs-")), await inForce(), store).take(), 0);
    assert.deepEqual(store.all(), []);
  });
});
