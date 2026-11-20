import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { dateText, durationText, elapsedText, momentText, sizeText } from "../../src/i18n/formats.ts";
import { speaking } from "./in-language.ts";

/** A text with its spaces folded, the no-break ones a language writes between a number and its unit included. */
const folded = (text: string): string => text.replace(/\s/g, " ");

const inEnglish = speaking("en");

describe("the duration of a session", () => {
  it("is written in seconds under a minute, rounded", () => {
    assert.deepEqual([0, 499, 1500, 59_499].map(durationText).map(folded), ["0 s", "0 s", "2 s", "59 s"]);
  });

  it("is written in minutes and seconds from a minute on, the seconds on two digits", () => {
    assert.deepEqual([59_500, 65_000, 113_600, 3_600_000].map(durationText).map(folded), ["1 min 00 s", "1 min 05 s", "1 min 54 s", "60 min 00 s"]);
  });

  it("is written in the units of English in English", async () => {
    await inEnglish();
    assert.deepEqual([42_000, 65_000].map(durationText).map(folded), ["42 sec", "1 min 05 sec"]);
  });
});

describe("the time an action took", () => {
  it("is written in milliseconds under a second, rounded", () => {
    assert.deepEqual([0, 40.4, 999].map(elapsedText).map(folded), ["0 ms", "40 ms", "999 ms"]);
  });

  it("is written in seconds with a decimal under a minute, and as a duration beyond", () => {
    assert.deepEqual([1000, 1250, 59_940, 60_000, 113_600].map(elapsedText).map(folded), ["1,0 s", "1,3 s", "59,9 s", "1 min 00 s", "1 min 54 s"]);
  });

  it("writes its decimal as English does in English", async () => {
    await inEnglish();
    assert.equal(folded(elapsedText(1250)), "1.3 sec");
  });
});

describe("a moment of a session", () => {
  it("is written as its day and its time, in universal time, as each language writes them", async () => {
    assert.equal(momentText("2026-11-15T14:44:06.348Z"), "15 nov. 2026, 14:44:06 UTC");
    await inEnglish();
    assert.equal(folded(momentText("2026-11-15T14:44:06.348Z")), "Nov 15, 2026, 2:44:06 PM UTC");
  });
});

describe("a date of the console", () => {
  it("is written to the minute, its month abbreviated, as each language writes it", async () => {
    assert.match(folded(dateText("2026-11-18T09:12:00.000Z")), /^18 nov\. 2026, \d\d:\d\d$/);
    await inEnglish();
    assert.match(folded(dateText("2026-11-18T09:12:00.000Z")), /^Nov 18, 2026, \d{1,2}:\d\d [AP]M$/);
  });
});

describe("a size", () => {
  it("is written in bytes under a thousand, in kilobytes under a million, in megabytes beyond, to a decimal at most", () => {
    assert.deepEqual(
      [0, 999, 1000, 1250, 999_949, 1_000_000, 2_340_000].map((bytes) => folded(sizeText(bytes))),
      ["0 octet", "999 octets", "1 ko", "1,3 ko", "999,9 ko", "1 Mo", "2,3 Mo"],
    );
  });
});
