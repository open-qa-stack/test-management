import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { actionOf, idOf, ignore, NEW_ITEMS, NO_EDIT, pressOf } from "../../src/configuration/configuration-edit.ts";

describe("what the person does to a field", () => {
  const field = { name: "/model/model", value: "m", checked: false };

  it("sets a text or a choice, and leaves the key out when it is emptied", () => {
    assert.deepEqual(actionOf({ ...field, kind: "text" }), { type: "edit", pointer: "/model/model", value: "m" });
    assert.deepEqual(actionOf({ ...field, kind: "choice", value: "" }), { type: "edit", pointer: "/model/model", value: undefined });
  });

  it("sets a number as a number, and leaves the key out when it is emptied", () => {
    assert.deepEqual(actionOf({ ...field, kind: "number", value: "12" }), { type: "edit", pointer: "/model/model", value: 12 });
    assert.deepEqual(actionOf({ ...field, kind: "number", value: "" }), { type: "edit", pointer: "/model/model", value: undefined });
  });

  it("sets a member of a set with the defaults of the set, and a level of autonomy", () => {
    assert.deepEqual(actionOf({ name: "/design/levels", value: "on", checked: true, kind: "member", member: "smoke", defaults: "functional,business" }), {
      type: "toggle",
      pointer: "/design/levels",
      member: "smoke",
      on: true,
      defaults: ["functional", "business"],
    });
    for (const defaults of [undefined, ""])
      assert.deepEqual(
        actionOf({
          name: "/model/capabilities",
          value: "on",
          checked: false,
          kind: "member",
          member: "vision",
          ...(defaults === undefined ? {} : { defaults }),
        }),
        { type: "toggle", pointer: "/model/capabilities", member: "vision", on: false, defaults: [] },
      );
    assert.deepEqual(actionOf({ ...field, kind: "level", value: "bounded" }), { type: "level", level: "bounded" });
    assert.deepEqual(actionOf({ ...field, kind: "level", value: "autonomous" }), { type: "level", level: "autonomous" });
  });
});

describe("what the person presses", () => {
  it("adds an item of its kind to a list, removes an item, and does nothing for a button that says neither", () => {
    assert.deepEqual(pressOf({ add: "/applications/0/environments", item: "environment" }), {
      type: "add",
      pointer: "/applications/0/environments",
      item: NEW_ITEMS.environment,
    });
    assert.deepEqual(pressOf({ remove: "/applications/1" }), { type: "remove", pointer: "/applications/1" });
    for (const button of [{}, { add: "/applications" }, { add: "/applications", item: "toString" }]) assert.equal(pressOf(button), undefined);
  });
});

describe("a field outside a screen that holds a draft", () => {
  it("applies nothing and finds no error, and is named after where it is", () => {
    assert.equal(ignore(), undefined);
    assert.deepEqual(NO_EDIT, { change: ignore, click: ignore, errors: [] });
    assert.equal(idOf("/applications/0/environments/1/uiUrl"), "config-applications-0-environments-1-uiUrl");
  });
});
