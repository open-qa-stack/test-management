import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { describe, it } from "vitest";
import { closedPort } from "../src/index.ts";

describe("a closed port", () => {
  it("is out of the ports a system gives a server that asks for any, and is another one at each call", async () => {
    const [first, second] = [await closedPort(), await closedPort()];
    assert.ok(first >= 20_000 && first < 30_000 && second >= 20_000 && second < 30_000, `${first}, ${second}`);
    assert.notEqual(first, second);
  });

  it("is never a port a server listens on, and there is none when every port to try is taken", async () => {
    const taken = await closedPort();
    const server = createServer().listen(taken, "127.0.0.1");
    await once(server, "listening");
    try {
      const free = await closedPort();
      assert.equal(await closedPort([taken, free]), free);
      await assert.rejects(closedPort([taken]), /^Error: no port to try is closed$/);
    } finally {
      server.close();
    }
  });
});
