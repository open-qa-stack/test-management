import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { RepositoryTest, TestEdit } from "@open-qa-stack/domain/sessions";
import { TestEditPanel } from "../../src/tests/test-edit-panel.tsx";
import type { TestTextPanelProps } from "../../src/tests/test-text-panel.tsx";
import { at } from "../render.ts";
import { DETAIL, TESTS } from "./tests-fixture.ts";

/** Two tests of one file, in a group. */
const GROUPED: RepositoryTest = { ...DETAIL, title: "Policies › Display the detail of a policy" };
const SIBLING: RepositoryTest = { ...DETAIL, title: "Policies › Edit a policy" };

/** The panel a route opens on a test, as the props of the panel of a text it is drawn as, with what it was asked to change. */
function panelAt(hash: string, test: RepositoryTest = DETAIL): { readonly props?: TestTextPanelProps; readonly changes: TestEdit[] } {
  const changes: TestEdit[] = [];
  const element = TestEditPanel({
    test,
    route: at(hash),
    tests: [...TESTS, GROUPED, SIBLING],
    saving: { pending: false },
    onChange: (changed, edit) => {
      assert.equal(changed, test);
      changes.push(edit);
    },
  }) as { readonly props: TestTextPanelProps } | null;
  return { ...(element === null ? {} : { props: element.props }), changes };
}

describe("the panel that changes a test", () => {
  it("is none unless the route names the title or a step the test has", () => {
    for (const hash of [
      "#/tests/view",
      "#/tests/view?panel=step",
      "#/tests/view?panel=account:0",
      "#/tests/view?panel=step:0",
      "#/tests/view?panel=step:x",
      "#/tests/view?panel=step:3",
    ])
      assert.equal(panelAt(hash).props, undefined, hash);
  });

  it("changes the own title of the test, which another test of its file may not have, and closes on the card", () => {
    const { props, changes } = panelAt("#/tests/view?path=a&panel=title", GROUPED);
    assert.deepEqual([props!.title, props!.value, props!.close], ["Titre du test", "Display the detail of a policy", "#/tests/view?path=a"]);
    assert.equal(props!.refuse!("Edit a policy"), "Un autre test de ce fichier porte déjà ce titre.");
    assert.equal(props!.refuse!("Display the detail of a policy"), undefined, "its own title is not taken");
    props!.onSave("Show a policy");
    assert.deepEqual(changes, [{ title: "Show a policy" }]);
  });

  it("changes the text of a step without the number the harness wrote before it", () => {
    const { props, changes } = panelAt("#/tests/view?panel=step:2");
    assert.deepEqual([props!.title, props!.label, props!.value], ["Étape 2", "Ce que fait l’étape", "Read its amounts"]);
    props!.onSave("Read the amounts");
    assert.deepEqual(changes, [{ step: 2, text: "Read the amounts" }]);
  });
});
