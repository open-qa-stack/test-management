import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "vitest";
import { CONFIG_FILE_NAME } from "@open-qa-stack/domain";
import { configText } from "@open-qa-stack/testing/test-repository";
import { testDigests } from "@open-qa-stack/tools";
import { Configuration } from "../src/index.ts";
import { ExecutionRecorder } from "../src/sessions/execution-recorder.ts";
import { MemoryConfigurationStore } from "./support/memory-configuration-store.ts";
import { MemoryExecutionStore } from "./support/memory-execution-store.ts";

/** Where the report of the run is, from the root of the test repository. */
const REPORT = ".oqas/runs/run-2026-11-19T10-00-00-000Z/report.json";

/** The text of the test of the search of the orders. */
const SEARCH = 'test("Search an order", async () => {});\n';

/** A test of a report, passed in the project of the shop. */
const spec = (title: string, file: string) => ({
  title,
  file,
  line: 3,
  tests: [{ projectName: "shop", status: "expected", expectedStatus: "passed", results: [{ status: "passed", duration: 50 }] }],
});

/** A report of two tests of the search, whose file is there, and one of the payments, whose file is gone. */
const report = JSON.stringify({
  suites: [
    {
      title: "shop/search.spec.ts",
      file: "shop/search.spec.ts",
      specs: [spec("Search an order", "shop/search.spec.ts"), spec("Search nothing", "shop/search.spec.ts")],
    },
    { title: "shop/pay.spec.ts", file: "shop/pay.spec.ts", specs: [spec("Pay", "shop/pay.spec.ts")] },
  ],
});

/** Writes a file of a test repository, with its folders. */
function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A test repository whose tests are in the folder of the applications given, with the report of a run, and a commit when asked. */
function repository(appsDir: string, committed: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "oqas-execution-recorder-"));
  write(root, `${appsDir}/shop/search.spec.ts`, SEARCH);
  write(root, REPORT, report);
  if (committed) {
    const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: root });
    git("init", "-q");
    git("add", ".");
    git("commit", "-q", "-m", "tests");
  }
  return root;
}

/** The recorder of a test repository, with a store of its own. */
function recorder(root: string): { recorder: ExecutionRecorder; store: MemoryExecutionStore } {
  const store = new MemoryExecutionStore();
  const configuration = new Configuration(new MemoryConfigurationStore(), root);
  return { recorder: new ExecutionRecorder({ repository: root, configuration, store, now: () => new Date("2026-11-19T10:00:05.000Z") }), store };
}

describe("the execution of the tests of a session, as it is kept", () => {
  it("names each test by its path in the test repository and its titles, with the commit of the repository, the digests of its file and of itself", async () => {
    const root = repository("apps", true);
    const { recorder: kept, store } = recorder(root);
    const execution = await kept.record(REPORT, { origin: "design", sessionId: "s1" });
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    const digest = createHash("sha256").update(SEARCH).digest("hex");
    const testDigest = (await testDigests(SEARCH)).get("Search an order")!;
    assert.ok(execution !== undefined);
    assert.match(execution.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(execution, {
      id: execution.id,
      origin: "design",
      sessionId: "s1",
      ranAt: "2026-11-19T10:00:05.000Z",
      commit,
      report: REPORT,
      results: [
        {
          path: "apps/shop/search.spec.ts",
          title: "Search an order",
          project: "shop",
          verdict: "passed",
          durationMs: 50,
          fileDigest: digest,
          testDigest,
          committed: true,
        },
        { path: "apps/shop/search.spec.ts", title: "Search nothing", project: "shop", verdict: "passed", durationMs: 50, fileDigest: digest },
        { path: "apps/shop/pay.spec.ts", title: "Pay", project: "shop", verdict: "passed", durationMs: 50 },
      ],
    });
    assert.deepEqual(
      store.all().map(({ results }) => results.map(({ version }) => version)),
      [[1, undefined, undefined]],
    );
  });

  it("tells whether each test is the same in the commit, whatever its comments and its layout, and keeps it under a new version once it changed", async () => {
    const root = repository("apps", true);
    const { recorder: kept, store } = recorder(root);
    write(root, "apps/shop/search.spec.ts", "// Searches an order.\ntest('Search an order', async () => {\n});\n");
    write(root, "apps/shop/pay.spec.ts", 'test("Pay", async () => {});\n');
    const reformatted = await kept.record(REPORT, { origin: "design", sessionId: "s1" });
    write(root, "apps/shop/search.spec.ts", 'test("Search an order", async () => { await Promise.resolve(); });\n');
    const changed = await kept.record(REPORT, { origin: "design", sessionId: "s2" });
    assert.deepEqual(
      [reformatted, changed].map((execution) => [execution?.results[0]?.committed, execution?.results[2]?.committed]),
      [
        [true, false],
        [false, false],
      ],
    );
    assert.deepEqual(
      store.all().map(({ results }) => results[0]?.version),
      [2, 1],
    );
    const [latest] = await store.versions("apps/shop/search.spec.ts");
    assert.ok(latest !== undefined && latest.number === 2 && !("commit" in latest));
  });

  it("finds the tests in the folder of the applications the configuration names, and keeps no commit for a folder that has none", async () => {
    const root = repository("suites", false);
    const document = { ...(JSON.parse(configText("http://127.0.0.1:9/v1")) as object), repository: { appsDir: "suites" } };
    writeFileSync(join(root, CONFIG_FILE_NAME), JSON.stringify(document));
    const execution = await recorder(root).recorder.record(REPORT, { origin: "design", sessionId: "s1" });
    assert.ok(execution !== undefined && !("commit" in execution));
    assert.deepEqual(
      execution.results.map(({ path, fileDigest, testDigest, committed }) => [path, fileDigest !== undefined, testDigest !== undefined, committed]),
      [
        ["suites/shop/search.spec.ts", true, true, undefined],
        ["suites/shop/search.spec.ts", true, false, undefined],
        ["suites/shop/pay.spec.ts", false, false, undefined],
      ],
    );
  });

  it("keeps nothing of a report that cannot be read", async () => {
    const root = repository("apps", false);
    const { recorder: kept, store } = recorder(root);
    assert.equal(await kept.record(".oqas/runs/none/report.json", { origin: "design", sessionId: "s1" }), undefined);
    assert.deepEqual(store.all(), []);
  });
});
