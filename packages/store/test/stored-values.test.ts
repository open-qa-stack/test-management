import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { instant, jsonOf, storedJson } from "../src/database/stored-values.ts";

describe("a date the columns keep", () => {
  it("is written in ISO 8601, in UTC, to the millisecond, whatever way it was told", () => {
    assert.equal(instant(new Date("2026-11-14T09:00:00.120Z")), "2026-11-14T09:00:00.120Z");
    assert.equal(instant("2026-11-14T11:00:00+02:00"), "2026-11-14T09:00:00.000Z");
  });

  it("is read the same from the text SQLite kept and from the date the PostgreSQL client gives", () => {
    assert.equal(instant("2026-11-14T09:00:00.120Z"), instant(new Date("2026-11-14T09:00:00.120Z")));
  });

  it("sorts as a text the way the dates do", () => {
    const dates = ["2026-11-14T09:00:00.120Z", "2026-11-14T09:00:00.099Z", "2026-02-01T23:59:59.999Z", "2027-01-01T00:00:00.000Z"];
    assert.deepEqual(
      dates.map(instant).sort(),
      dates
        .map((date) => new Date(date))
        .sort((one, other) => one.getTime() - other.getTime())
        .map(instant),
    );
  });

  it("is refused when it is no date: nothing but a date is kept as one", () => {
    assert.throws(() => instant("not a date"), RangeError);
  });
});

describe("a JSON value the columns keep", () => {
  it("is written as its text, its fields in the order they were given", () => {
    assert.equal(storedJson({ z: 1, a: [2] }), '{"z":1,"a":[2]}');
  });

  it("is read from the text SQLite kept, and is what the PostgreSQL client already parsed", () => {
    const value = { z: 1, a: [2] };
    assert.deepEqual(jsonOf<typeof value>('{"z":1,"a":[2]}'), value);
    assert.equal(jsonOf(value), value);
    assert.deepEqual(jsonOf<unknown[]>("[]"), []);
  });
});
