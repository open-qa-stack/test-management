import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { inboxLineOf, inboxMessage } from "../src/index.ts";

describe("a line of the inbox of a run", () => {
  it("is written as one JSON object: when the person sent the message, then what they say", () => {
    assert.equal(
      inboxLineOf("2026-11-14T09:00:01.000Z", 'not "that" page\nthe other'),
      '{"at":"2026-11-14T09:00:01.000Z","text":"not \\"that\\" page\\nthe other"}',
    );
  });

  it("is read back as the message it was written from", () => {
    assert.deepEqual(inboxMessage(inboxLineOf("2026-11-14T09:00:01.000Z", "not that page")), { at: "2026-11-14T09:00:01.000Z", text: "not that page" });
  });

  it("is a message whatever it gives as its date, which a run does not read", () => {
    assert.deepEqual(inboxMessage('{"text":"not that page"}'), { at: undefined, text: "not that page" });
    assert.deepEqual(inboxMessage('{"at":3,"text":"not that page"}'), { at: 3, text: "not that page" });
  });

  it("is no message when it is no JSON object, or says nothing", () => {
    for (const line of ["", "not a line", "null", "[]", '"text"', "{}", '{"text":3}', '{"text":""}', '{"text":"  \\n"}']) {
      assert.equal(inboxMessage(line), undefined, line);
    }
  });
});
