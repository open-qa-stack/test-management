import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { harnessText, isWorded, rowText } from "../../src/agent/harness-words.ts";

describe("what the harness says, in the words of the console", () => {
  it("words a text of a form it knows, with the values it names, and leaves any other as it is", () => {
    assert.equal(harnessText("The card of shop-api is up to date; it was kept."), "La fiche de shop-api est à jour ; elle est conservée.");
    assert.equal(harnessText("Every attempt passed."), "Chaque essai a réussi.");
    assert.equal(harnessText("The plan was refused by the harness"), "Le harnais refuse le plan");
    assert.equal(harnessText("Something new."), "Something new.");
    assert.equal(isWorded("The execution succeeded."), true);
    assert.equal(isWorded("Failed: Error: expect(locator).toBeVisible() failed"), false);
  });

  it("says the execution ran, never that it succeeded, since its tests may have failed", () => {
    assert.equal(harnessText("The execution succeeded."), "Les tests ont été exécutés ; leurs verdicts sont dans le bilan.");
  });

  it("counts the sources of a row of files of domains kept as they were", () => {
    const notes = ["orders", "billing"].map(
      (domain) => ({ kind: "note", at: "09:00:00", text: `The file of the domain ${domain} is up to date; it was kept.` }) as const,
    );
    const row = {
      kind: "repeated",
      at: "09:00:00",
      before: "The file of the domain ",
      after: " is up to date; it was kept.",
      sources: ["orders", "billing"],
      notes,
    } as const;
    assert.equal(rowText(row), "Les fichiers de 2 domaines sont à jour ; ils sont conservés.");
  });
});
