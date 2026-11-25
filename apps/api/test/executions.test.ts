import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Logger } from "@nestjs/common";
import type { PastRuns } from "@open-qa-stack/engine";
import { ExecutionsLifecycle } from "../src/executions/executions-lifecycle.ts";
import { CapturedLogger } from "./support/captured-logger.ts";

/** What the lifecycle logged at the startup of the API, over past runs that are taken as a test says. */
async function started(take: () => Promise<number>): Promise<string[]> {
  const logger = new CapturedLogger();
  Logger.overrideLogger(logger);
  try {
    await new ExecutionsLifecycle({ take } as unknown as PastRuns).onApplicationBootstrap();
  } finally {
    Logger.overrideLogger(false);
  }
  return logger.lines.map((line) => line.replace(/ Executions$/, ""));
}

describe("the past runs of the test repository, taken when the API starts", () => {
  it("are told when some were taken, and not when none was", async () => {
    assert.deepEqual(await started(async () => 2), ["log 2 past runs of the test repository are kept as executions."]);
    assert.deepEqual(await started(async () => 0), []);
  });

  it("do not stop the startup when they cannot be taken: it is logged", async () => {
    assert.deepEqual(await started(() => Promise.reject(new Error("The database is unreachable."))), [
      "warn The past runs of the test repository are not kept as executions: The database is unreachable.",
    ]);
    assert.deepEqual(await started(() => Promise.reject("lost")), ["warn The past runs of the test repository are not kept as executions: lost"]);
  });
});
