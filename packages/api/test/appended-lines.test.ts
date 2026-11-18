import assert from "node:assert/strict";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AppendedLines } from "../src/solo/appended-lines.ts";
import { temporaryFolder } from "./support/test-repository.ts";

describe("the lines appended to a file", () => {
  it("gives every completed line on the first reading, without the empty ones", async () => {
    const file = join(temporaryFolder(), "journal.jsonl");
    writeFileSync(file, '{"n":1}\n\n{"n":2}\n');
    assert.deepEqual(await new AppendedLines(file).read(), ['{"n":1}', '{"n":2}']);
  });

  it("never gives a line twice: a reading only holds what was appended since the one before", async () => {
    const file = join(temporaryFolder(), "journal.jsonl");
    writeFileSync(file, "one\n");
    const lines = new AppendedLines(file);
    assert.deepEqual(await lines.read(), ["one"]);
    assert.deepEqual(await lines.read(), []);
    appendFileSync(file, "two\nthree\n");
    assert.deepEqual(await lines.read(), ["two", "three"]);
    assert.deepEqual(await lines.read(), []);
  });

  it("waits for a line still being written, and gives it whole once it is ended", async () => {
    const file = join(temporaryFolder(), "journal.jsonl");
    writeFileSync(file, '{"text":"caf');
    const lines = new AppendedLines(file);
    assert.deepEqual(await lines.read(), []);
    appendFileSync(file, 'é"}\n{"text":"unfin');
    assert.deepEqual(await lines.read(), ['{"text":"café"}']);
    appendFileSync(file, 'ished"}\n');
    assert.deepEqual(await lines.read(), ['{"text":"unfinished"}']);
  });

  it("gives nothing for a file that does not exist yet, then its lines once it does", async () => {
    const file = join(temporaryFolder(), "later.jsonl");
    const lines = new AppendedLines(file);
    assert.deepEqual(await lines.read(), []);
    writeFileSync(file, "here\n");
    assert.deepEqual(await lines.read(), ["here"]);
  });
});
