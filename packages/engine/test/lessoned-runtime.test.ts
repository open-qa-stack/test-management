import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { AgentRuntime, SessionOptions } from "@open-qa-stack/domain";
import { LessonedRuntime } from "../src/runtime/lessoned-runtime.ts";

describe("the runtime that gives the agents the lessons of their work", () => {
  it("ends the instructions of each session with the lessons, and closes what it wraps", async () => {
    const opened: SessionOptions[] = [];
    let closed = false;
    const inner: AgentRuntime = {
      openSession: (options) => {
        opened.push(options);
        return Promise.resolve({ send: async function* () {}, close: () => Promise.resolve() });
      },
      close: () => {
        closed = true;
        return Promise.resolve();
      },
    };
    const runtime = new LessonedRuntime(inner, "Follow the rule.");
    await runtime.openSession({ instructions: "Plan the tests." } as SessionOptions);
    await runtime.close();
    assert.deepEqual([opened.map(({ instructions }) => instructions), closed], [["Plan the tests.\n\nFollow the rule."], true]);
  });
});
