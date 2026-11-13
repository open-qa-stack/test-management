import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { TEST_ENVIRONMENT } from "./support/environment.ts";

const PROBES = ["first", "second"].map((name) => fileURLToPath(new URL(`isolation/${name}.probe.js`, import.meta.url)));

describe("two test files of data access", () => {
  it("run in parallel without seeing the data of each other", async () => {
    const meeting = mkdtempSync(join(tmpdir(), "oqas-isolation-"));
    try {
      const { NODE_TEST_CONTEXT: _nested, NODE_OPTIONS: _options, ...outer } = TEST_ENVIRONMENT;
      const env = { ...outer, OQAS_ISOLATION_MEETING: meeting };
      const run = await new Promise<{ code: number; out: string }>((resolve) =>
        execFile(process.execPath, ["--test", "--test-concurrency=2", "--test-reporter=tap", ...PROBES], { env, encoding: "utf8" }, (error, out) =>
          resolve({ code: error === null ? 0 : (error.code as number), out }),
        ),
      );
      assert.equal(run.code, 0, run.out);
      assert.match(run.out, /# pass 2/);
    } finally {
      rmSync(meeting, { recursive: true, force: true });
    }
  });
});
