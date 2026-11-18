import assert from "node:assert/strict";
import { inspect } from "node:util";
import { describe, it } from "vitest";
import { DatabaseUrl } from "../src/database/database-url.ts";

const PASSWORD = "witness-pass/7@x";
const RAW = `postgres://oqas:${encodeURIComponent(PASSWORD)}@127.0.0.1:5432/oqas`;

function parsed(raw: string): DatabaseUrl {
  const url = DatabaseUrl.parse(raw);
  assert.ok(url !== undefined);
  return url;
}

describe("a database URL", () => {
  it("is a postgres or postgresql URL with a host name, whatever its password, which names a server", () => {
    for (const raw of ["postgres://127.0.0.1/oqas", "postgresql://oqas:p%40ss@db.example:5432/oqas?sslmode=require"]) {
      const url = parsed(raw);
      assert.deepEqual([url.reveal(), url.file], [raw, undefined]);
    }
  });

  it("is sqlite: followed by the path of a file, or by :memory: for a database kept in memory", () => {
    const files = {
      "sqlite:/srv/tests/.oqas/oqas.db": "/srv/tests/.oqas/oqas.db",
      "sqlite:///srv/tests/.oqas/oqas.db": "/srv/tests/.oqas/oqas.db",
      "sqlite:state/oqas.db": "state/oqas.db",
      "sqlite://state/oqas.db": "state/oqas.db",
      "sqlite:C:\\tests\\oqas.db": "C:\\tests\\oqas.db",
      "sqlite::memory:": ":memory:",
    };
    for (const [raw, file] of Object.entries(files)) {
      const url = parsed(raw);
      assert.deepEqual([url.reveal(), url.file], [raw, file], raw);
    }
  });

  it("is made from the path of a file, for the SQLite database that file holds", () => {
    const url = DatabaseUrl.ofFile("/srv/tests/.oqas/oqas.db");
    assert.deepEqual([url.reveal(), url.file], ["sqlite:/srv/tests/.oqas/oqas.db", "/srv/tests/.oqas/oqas.db"]);
    assert.equal(DatabaseUrl.parse(url.reveal())?.file, url.file);
  });

  it("is nothing when the text is no URL, names another scheme or no host, or holds a password that cannot be decoded", () => {
    for (const raw of [
      "",
      "oqas",
      "mysql://127.0.0.1/oqas",
      "sqlite:",
      "sqlite://",
      "postgres:///oqas",
      "postgres:///oqas?host=/var/run/postgresql",
      "postgres://oqas:%zz@127.0.0.1/oqas",
    ]) {
      assert.equal(DatabaseUrl.parse(raw), undefined, raw);
    }
  });

  it("hands itself out only when asked to", () => {
    assert.equal(parsed(RAW).reveal(), RAW);
  });

  it("never prints itself, as a string, as JSON or when inspected", () => {
    const url = parsed(RAW);
    for (const shown of [String(url), JSON.stringify({ url }), inspect(url), inspect({ url }, { depth: 5, showHidden: true })]) {
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

  it("leaves the path of a file in a text: it is no secret, and says where to look", () => {
    const url = parsed("sqlite:/srv/tests/.oqas/oqas.db");
    assert.equal(url.redact("/srv/tests/.oqas/oqas.db cannot be opened"), "/srv/tests/.oqas/oqas.db cannot be opened");
    assert.equal(String(url), "[redacted database URL]");
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(parsed(RAW)));
  });
});
