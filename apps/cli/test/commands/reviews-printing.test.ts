import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { CorrectedTest } from "@open-qa-stack/domain";
import type { Asked } from "../../src/commands/asked.ts";
import type { Operations } from "../../src/commands/operations.ts";
import { reviewed } from "../../src/commands/reviews-command.ts";

const CORRECTED = {
  decision: { id: "t1", status: "in_correction", at: "2026-11-27T10:00:00.000Z", instruction: "Use Max.", session: "s1" },
  session: { id: "s1", openedAt: "2026-11-27T09:00:00.000Z", lastEventAt: "2026-11-27T10:00:00.000Z", state: "running" },
} as const satisfies CorrectedTest;

describe("oqas reviews correct, as a conversation runs it", () => {
  it("asks the correction on the operations it holds, whose host runs the session, and says which session corrects the test", async () => {
    const asked: unknown[] = [];
    const reviews = { correct: (id: string, correction: unknown) => (asked.push([id, correction]), Promise.resolve(CORRECTED)) };
    const written: string[] = [];
    const io = { stdout: { write: (text: string) => written.push(text) } };
    const printing = (output: "text" | "json") => ({ options: { output }, io }) as unknown as Pick<Asked<"reviews">, "options" | "io">;
    const command = { name: "reviews", action: "correct", id: "t1", correction: { instruction: "Use Max." } } as const;
    assert.equal(await reviewed({ reviews } as unknown as Pick<Operations, "reviews">, command, printing("text")), 0);
    await reviewed({ reviews } as unknown as Pick<Operations, "reviews">, command, printing("json"));
    assert.deepEqual(asked, [
      ["t1", { instruction: "Use Max." }],
      ["t1", { instruction: "Use Max." }],
    ]);
    assert.deepEqual(written, ["The test t1 is being corrected by the session s1.\n", `${JSON.stringify(CORRECTED)}\n`]);
  });
});
