import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hrefTo, isUnder, parseRoute } from "../../src/routing/route.ts";

describe("the route of the console", () => {
  it("is read from the fragment of the address: the segments of its path, the parameters of its query", () => {
    assert.deepEqual(parseRoute(""), { path: [], query: {} });
    assert.deepEqual(parseRoute("#/"), { path: [], query: {} });
    assert.deepEqual(parseRoute("#/agent/sessions/a?show=talk&look=3"), { path: ["agent", "sessions", "a"], query: { show: "talk", look: "3" } });
    assert.deepEqual(parseRoute("/agent/"), { path: ["agent"], query: {} });
  });

  it("is written as a link, with its parameters when it has some", () => {
    assert.equal(hrefTo("/agent"), "#/agent");
    assert.equal(hrefTo("/agent/sessions/a", { show: "talk", agent: "planner" }), "#/agent/sessions/a?show=talk&agent=planner");
  });

  it("is under a path when its first segments are those of the path, and the home only under itself", () => {
    assert.equal(isUnder(parseRoute("#/agent/sessions/a"), "/agent"), true);
    assert.equal(isUnder(parseRoute("#/agents"), "/agent"), false);
    assert.equal(isUnder(parseRoute("#/"), "/"), true);
    assert.equal(isUnder(parseRoute("#/agent"), "/"), false);
  });
});
