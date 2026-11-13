import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import { DatabaseUrl } from "../src/config/database-url.ts";

const PASSWORD = "witness-pass/7@x";
const RAW = `postgres://oqas:${encodeURIComponent(PASSWORD)}@127.0.0.1:5432/oqas`;

function parsed(raw: string): DatabaseUrl {
  const url = DatabaseUrl.parse(raw);
  assert.ok(url !== undefined);
  return url;
}

describe("a database URL", () => {
  it("hands itself out only when asked to", () => {
    assert.equal(parsed(RAW).reveal(), RAW);
  });

  it("never prints itself, as a string, as JSON or when inspected", () => {
    const url = parsed(RAW);
    for (const shown of [String(url), `${url}`, JSON.stringify({ url }), inspect(url), inspect({ url }, { depth: 5, showHidden: true })]) {
      assert.ok(!shown.includes(PASSWORD) && !shown.includes(encodeURIComponent(PASSWORD)) && !shown.includes(RAW), shown);
    }
    assert.equal(String(url), "[redacted database URL]");
  });

  it("removes itself and its password, encoded or not, from a text", () => {
    const url = parsed(RAW);
    const text = `failed: ${RAW} with ${PASSWORD} and ${encodeURIComponent(PASSWORD)}`;
    assert.equal(url.redact(text), "failed: [redacted] with [redacted] and [redacted]");
  });

  it("leaves a text alone when the URL holds no password", () => {
    assert.equal(parsed("postgres://oqas@127.0.0.1/oqas").redact("connect ECONNREFUSED 127.0.0.1:5432"), "connect ECONNREFUSED 127.0.0.1:5432");
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(parsed(RAW)));
  });
});
