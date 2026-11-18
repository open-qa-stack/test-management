import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { asksToStop, focusAfterStop, STOP_CANCEL_ID, STOP_CONTROL_ID, withoutStop, withStop } from "../../src/agent/stop-request.ts";
import { at } from "../render.ts";

describe("the confirmation of the stop of a session", () => {
  it("is opened by the address that asks for it, and by no other", () => {
    assert.equal(asksToStop(at("#/agent/sessions/s?stop=ask")), true);
    assert.equal(asksToStop(at("#/agent/sessions/s?show=talk&stop=ask")), true);
    for (const query of ["", "?stop=", "?stop=yes", "?stop=asked", "?show=stop"]) assert.equal(asksToStop(at(`#/agent/sessions/s${query}`)), false, query);
  });

  it("opens and closes by a link to the same screen, which keeps what else its address holds", () => {
    assert.equal(withStop(at("#/agent/sessions/s")), "#/agent/sessions/s?stop=ask");
    assert.equal(withStop(at("#/agent/sessions/s?show=talk&agent=planner")), "#/agent/sessions/s?show=talk&agent=planner&stop=ask");
    assert.equal(withStop(at("#/agent/sessions/s?stop=ask")), "#/agent/sessions/s?stop=ask");
    assert.equal(withoutStop(at("#/agent/sessions/s?show=talk&stop=ask&agent=planner")), "#/agent/sessions/s?show=talk&agent=planner");
    assert.equal(withoutStop(at("#/agent/sessions/s?stop=ask")), "#/agent/sessions/s");
    assert.equal(withoutStop(at("#/agent/sessions/s")), "#/agent/sessions/s");
  });

  it("takes the focus to the way out when it opens, never to the button that stops, and gives it back to the bar when it closes", () => {
    assert.equal(focusAfterStop(false, true), `#${STOP_CANCEL_ID}`);
    assert.equal(focusAfterStop(true, false), `#${STOP_CONTROL_ID}`);
    assert.equal(focusAfterStop(false, false), undefined);
    assert.equal(focusAfterStop(true, true), undefined);
  });
});
