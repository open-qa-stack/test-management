import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { appendedAt, changedAt, removedAt, segmentsOf, valueAt } from "../../src/configuration/json-pointer.ts";

const DOCUMENT = { a: { b: [{ c: 1 }, { c: 2 }] }, "x/y": { "~z": true } };

describe("a JSON Pointer", () => {
  it("reads its segments, unescaped, and none for the whole document", () => {
    assert.deepEqual(segmentsOf("/a/b/0"), ["a", "b", "0"]);
    assert.deepEqual(segmentsOf("/x~1y/~0z"), ["x/y", "~z"]);
    assert.deepEqual(segmentsOf(""), []);
  });

  it("reads the value it names, and nothing where there is none", () => {
    assert.equal(valueAt(DOCUMENT, "/a/b/1/c"), 2);
    assert.equal(valueAt(DOCUMENT, "/x~1y/~0z"), true);
    assert.equal(valueAt(DOCUMENT, "/a/b/1/c/d"), undefined);
    assert.equal(valueAt(DOCUMENT, "/missing/key"), undefined);
    assert.equal(valueAt(DOCUMENT, ""), DOCUMENT);
  });

  it("sets a value in a copy, makes the objects missing on the way, and removes a key set to nothing", () => {
    const changed = changedAt(DOCUMENT, "/a/b/1/c", 3);
    assert.deepEqual(changed.a.b, [{ c: 1 }, { c: 3 }]);
    assert.equal(DOCUMENT.a.b[1]!.c, 2);
    assert.equal(changed.a.b[0], DOCUMENT.a.b[0]);
    assert.deepEqual(changedAt({}, "/repository/appsDir", "tests"), { repository: { appsDir: "tests" } });
    assert.deepEqual(changedAt({ a: 1, b: 2 }, "/a", undefined), { b: 2 });
    assert.deepEqual(changedAt({ a: 1 }, "", { b: 2 }), { b: 2 });
  });

  it("appends to a list in a copy, and makes the list when there is none", () => {
    assert.deepEqual(appendedAt(DOCUMENT, "/a/b", { c: 3 }).a.b, [{ c: 1 }, { c: 2 }, { c: 3 }]);
    assert.deepEqual(appendedAt({ a: {} }, "/a/list", 1), { a: { list: [1] } });
  });

  it("removes an item of a list, or a key of an object, in a copy", () => {
    assert.deepEqual(removedAt(DOCUMENT, "/a/b/0").a.b, [{ c: 2 }]);
    assert.deepEqual(removedAt(DOCUMENT, "/x~1y/~0z")["x/y"], {});
    assert.deepEqual(removedAt({ a: 1, b: 2 }, "/a"), { b: 2 });
  });
});
