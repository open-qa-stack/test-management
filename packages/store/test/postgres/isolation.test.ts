import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const run = promisify(execFile);
const PROBE = fileURLToPath(new URL("isolation/probe.ts", import.meta.url));

describe("two processes that test data access", () => {
  it("run at the same time without seeing the data of each other", async () => {
    const meeting = mkdtempSync(join(tmpdir(), "oqas-isolation-"));
    try {
      await assert.doesNotReject(
        Promise.all([run(process.execPath, [PROBE, meeting, "first", "second"]), run(process.execPath, [PROBE, meeting, "second", "first"])]),
      );
    } finally {
      rmSync(meeting, { recursive: true, force: true });
    }
  });
});
