import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { actionOf, idOf, ignore, NEW_ITEMS, NO_EDIT, pressOf } from "../../src/configuration/configuration-edit.ts";

describe("what the person does to a field", () => {
  const field = { name: "/model/model", value: "m", checked: false };

  it("sets a text or a choice, and leaves the key out when it is emptied", () => {
    assert.deepEqual(actionOf({ ...field, kind: "text" }), { type: "edit", pointer: "/model/model", value: "m" });
    assert.deepEqual(actionOf({ ...field, kind: "choice", value: "" }), { type: "edit", pointer: "/model/model", value: undefined });
  });

  it("gives a role its own model, with nothing tuned on the former, and that of every one when it is emptied", () => {
    const role = { ...field, name: "/model/roles/reviewer", kind: "role" as const };
    assert.deepEqual(actionOf(role), { type: "edit", pointer: "/model/roles/reviewer", value: { model: "m" } });
    assert.deepEqual(actionOf({ ...role, value: "" }), { type: "edit", pointer: "/model/roles/reviewer", value: undefined });
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
    assert.deepEqual(actionOf({ ...field, kind: "connection", value: "github" }), { type: "connection", choice: "github" });
    assert.deepEqual(actionOf({ name: "secret-MODEL_KEY", value: "sk", checked: false, kind: "secret", variable: "MODEL_KEY" }), {
      type: "value",
      name: "MODEL_KEY",
      value: "sk",
    });
  });
});

describe("what the person presses", () => {
  it("writes false for a flag unchecked, and leaves its key out once it is checked again", () => {
    const pointer = "/applications/0/environments/0/allow/design";
    assert.deepEqual(actionOf({ name: pointer, value: "on", checked: false, kind: "flag" }), { type: "edit", pointer, value: false });
    assert.deepEqual(actionOf({ name: pointer, value: "on", checked: true, kind: "flag" }), { type: "edit", pointer, value: undefined });
  });

  it("sets the reach of a source: the whole project leaves its attachments out, applications start with one to choose", () => {
    const reach = { name: "/knowledge/2/attachments", checked: false, kind: "reach" } as const;
    assert.deepEqual(actionOf({ ...reach, value: "project" }), { type: "edit", pointer: "/knowledge/2/attachments", value: undefined });
    assert.deepEqual(actionOf({ ...reach, value: "applications" }), { type: "edit", pointer: "/knowledge/2/attachments", value: [{ application: "" }] });
  });

  it("adds an item of its kind to a list, removes an item, and does nothing for a button that says neither", () => {
    assert.deepEqual(pressOf({ add: "/applications/0/environments", item: "environment" }), {
      type: "add",
      pointer: "/applications/0/environments",
      item: NEW_ITEMS.environment,
    });
    assert.deepEqual(pressOf({ add: "/knowledge", item: "stored" }), {
      type: "add",
      pointer: "/knowledge",
      item: { id: "", type: "document", stored: true },
    });
    assert.deepEqual(pressOf({ add: "/knowledge/0/attachments", item: "attachment" }), {
      type: "add",
      pointer: "/knowledge/0/attachments",
      item: { application: "" },
    });
    assert.deepEqual(pressOf({ remove: "/applications/1" }), { type: "remove", pointer: "/applications/1" });
    for (const button of [{}, { add: "/applications" }, { add: "/applications", item: "toString" }]) assert.equal(pressOf(button), undefined);
  });
});

describe("a field outside a screen that holds a draft", () => {
  it("applies nothing and finds no error, and is named after where it is", () => {
    assert.equal(ignore(), undefined);
    assert.deepEqual(NO_EDIT, { change: ignore, click: ignore, errors: [], values: {} });
    assert.equal(idOf("/applications/0/environments/1/uiUrl"), "config-applications-0-environments-1-uiUrl");
  });
});
