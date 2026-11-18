import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { eyeIdOf, focusAfterLook, LOOK_TITLE_ID, openedLookOf, withoutLook } from "../../src/agent/opened-look.ts";
import type { SessionScript } from "@open-qa-stack/domain/sessions";
import { at } from "../render.ts";

const LOOK = { kind: "page", name: "card", lines: ["a rule"] } as const;

/** A session whose second step looked at something, whose third did not, and whose last has not answered. */
const SCRIPT: SessionScript = {
  id: "s",
  title: "A session",
  sources: [],
  stage: "live",
  steps: [
    { kind: "say", from: "user", at: "10:00:00", text: "Cover the quotes." },
    { kind: "tool", from: "planner", at: "10:00:01", tool: "shop_goto", title: "Opened the form", look: LOOK },
    { kind: "tool", from: "planner", at: "10:00:02", tool: "propose_plan", title: "Proposed a plan" },
    { kind: "tool", from: "writer", at: "10:00:03", tool: "run_test", title: "Ran the test", pending: true },
  ],
};

describe("the look an address opens", () => {
  it("is the look of the action the address names by its rank, with the sentence of that action", () => {
    assert.deepEqual(openedLookOf(at("#/agent/sessions/s?show=talk&look=1"), SCRIPT), {
      index: 1,
      action: "Opened the form",
      look: { kind: "document", source: "card", excerpt: ["a rule"], caption: "La page, telle que l’outil l’a rendue à l’agent." },
    });
  });

  it("is nothing when the address names no step, a step that is no action, or an action that looked at nothing", () => {
    for (const query of ["", "?look=0", "?look=2", "?look=3", "?look=4", "?look=-1", "?look=", "?look=1.0", "?look=01", "?look=one"]) {
      assert.equal(openedLookOf(at(`#/agent/sessions/s${query}`), SCRIPT), undefined, query);
    }
  });
});

describe("the address that closes a look", () => {
  it("is the same screen without the look, with what else the address holds", () => {
    assert.equal(withoutLook(at("#/agent/sessions/s?show=talk&look=1&agent=planner")), "#/agent/sessions/s?show=talk&agent=planner");
    assert.equal(withoutLook(at("#/agent/sessions/s?look=1")), "#/agent/sessions/s");
    assert.equal(withoutLook(at("#/agent/sessions/s")), "#/agent/sessions/s");
  });
});

describe("the focus when a look opens or closes", () => {
  it("goes to the title of the panel when a look opens, or when another takes its place", () => {
    assert.equal(focusAfterLook(undefined, 1), `#${LOOK_TITLE_ID}`);
    assert.equal(focusAfterLook(1, 5), `#${LOOK_TITLE_ID}`);
  });

  it("comes back to the eye of the action when its look closes", () => {
    assert.equal(eyeIdOf(1), "look-eye-1");
    assert.equal(focusAfterLook(1, undefined), "#look-eye-1");
  });

  it("stays where it is when no look was open and none is", () => {
    assert.equal(focusAfterLook(undefined, undefined), undefined);
  });
});
