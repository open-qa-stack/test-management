import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { changingName, destructiveName } from "../src/browser/destructive-target.ts";

describe("an element whose name says it removes data", () => {
  it("is known by a word of its role name, its label or its text, whatever the case and the language", () => {
    assert.equal(destructiveName({ role: "button", name: " Delete " }), "Delete");
    assert.equal(destructiveName({ role: "menuitem", name: "Remove from the list" }), "Remove from the list");
    assert.equal(destructiveName({ label: "Supprimer le contrat" }), "Supprimer le contrat");
    assert.equal(destructiveName({ text: "Konto löschen" }), "Konto löschen");
  });

  it("is not seen in a word that only holds such a word, in an element without a name, nor in a test id", () => {
    assert.equal(destructiveName({ role: "button", name: "Undeleted orders" }), undefined);
    assert.equal(destructiveName({ role: "button", name: "Removed items" }), undefined);
    assert.equal(destructiveName({ role: "button", name: "Manage Policy" }), undefined);
    assert.equal(destructiveName({ role: "button" }), undefined);
    assert.equal(destructiveName({ testId: "delete-order" }), undefined);
  });
});

describe("an element whose name says it creates or changes data", () => {
  it("is known by a word of its name, whatever the case and the language, and not by a word that only holds one", () => {
    assert.equal(changingName({ role: "button", name: " Create Policy " }), "Create Policy");
    assert.equal(changingName({ label: "Enregistrer" }), "Enregistrer");
    assert.equal(changingName({ text: "Accept the request" }), "Accept the request");
    // A search, a navigation and a word that only holds such a word change nothing.
    assert.equal(changingName({ role: "button", name: "Search" }), undefined);
    assert.equal(changingName({ role: "link", name: "Manage Policy" }), undefined);
    assert.equal(changingName({ role: "button", name: "Address" }), undefined);
    assert.equal(changingName({ role: "button" }), undefined);
    assert.equal(changingName({ testId: "save-order" }), undefined);
  });
});
