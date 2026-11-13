import assert from "node:assert/strict";
import { describe, it } from "node:test";

import "../src/loopback-only.ts";
import { SLOW_MS, testSite } from "../src/index.ts";

describe("the test site", () => {
  it("serves its pages, its ping, its redirects and a 404 for the rest, and remembers each request", async () => {
    const site = await testSite({ "/home": "<h1>Home</h1>" }, { "/old": { status: 301, location: "/home" } });
    try {
      const page = await fetch(`${site.origin}/home?tab=1`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<title>\/home<\/title><\/head><body><h1>Home<\/h1>/);
      const redirect = await fetch(`${site.origin}/old`, { redirect: "manual" });
      assert.deepEqual([redirect.status, redirect.headers.get("location")], [301, "/home"]);
      const ping = await fetch(`${site.origin}/api/ping`);
      assert.deepEqual([ping.headers.get("access-control-allow-origin"), await ping.json()], ["*", { pong: true }]);
      const missing = await fetch(`${site.origin}/missing`);
      assert.deepEqual([missing.status, await missing.text()], [404, "not found"]);
      assert.deepEqual(site.requested, ["GET /home?tab=1", "GET /old", "GET /api/ping", "GET /missing"]);
    } finally {
      await site.close();
    }
  });

  it("serves no redirect unless given some", async () => {
    const site = await testSite({});
    try {
      assert.equal((await fetch(`${site.origin}/old`, { redirect: "manual" })).status, 404);
    } finally {
      await site.close();
    }
  });

  it("answers its slow path once SLOW_MS have passed", async () => {
    const site = await testSite({});
    try {
      const started = performance.now();
      const slow = await fetch(`${site.origin}/api/slow`);
      assert.deepEqual(await slow.json(), { slow: true });
      // The timers of Node.js may fire up to a millisecond early.
      assert.ok(performance.now() - started >= SLOW_MS - 1);
    } finally {
      await site.close();
    }
  });
});
