import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "../src/loopback-only.ts";
import { answer, scriptedServer, toolCalls } from "../src/index.ts";

describe("the scripted model server", () => {
  it("answers each request with the next reply, then with an error once the script is exhausted", async () => {
    const server = await scriptedServer([{ body: answer("m", "hello") }, { status: 429, body: "slow down", raw: true }]);
    try {
      const first = await fetch(`${server.baseUrl}/chat/completions`, { method: "POST", body: JSON.stringify({ model: "m" }) });
      assert.equal(first.status, 200);
      assert.equal(((await first.json()) as { choices: { message: { content: string } }[] }).choices[0]!.message.content, "hello");
      const second = await fetch(`${server.baseUrl}/models`);
      assert.deepEqual([second.status, await second.text()], [429, "slow down"]);
      const third = await fetch(`${server.baseUrl}/models`);
      assert.deepEqual([third.status, await third.json()], [500, { error: { message: "script exhausted" } }]);
      assert.deepEqual(
        server.requests.map((request) => request.body),
        [{ model: "m" }, undefined, undefined],
      );
    } finally {
      await server.close();
    }
  });

  it("writes completions that call tools, with or without text", () => {
    const call = { id: "c1", name: "look", arguments: { at: "home" } };
    assert.deepEqual((toolCalls("m", [call]) as { choices: { message: unknown; finish_reason: string }[] }).choices[0], {
      index: 0,
      message: { role: "assistant", content: "", tool_calls: [{ type: "function", id: "c1", function: { name: "look", arguments: '{"at":"home"}' } }] },
      finish_reason: "tool_calls",
    });
    assert.equal((toolCalls("m", [call], "looking") as { choices: { message: { content: string } }[] }).choices[0]!.message.content, "looking");
  });
});
