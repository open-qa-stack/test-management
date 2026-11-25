import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { LastVerdict } from "@open-qa-stack/domain/sessions";
import { TestTree } from "../../src/tests/test-tree.tsx";
import { linksOf, render, textOf } from "../render.ts";
import { DETAIL, SCREEN, SMOKE, TESTS } from "./tests-fixture.ts";

/** The verdicts of two tests of a domain, one that failed, and of one without a domain. */
const VERDICTS: readonly LastVerdict[] = [
  { path: DETAIL.path, title: DETAIL.title, verdict: "failed" },
  { path: SCREEN.path, title: SCREEN.title, verdict: "passed" },
  { path: SMOKE.path, title: SMOKE.title, verdict: "flaky" },
];

/** The tree beside the card of the test of the policies, as HTML. */
const tree = (failing = false, verdicts = VERDICTS): string => render(createElement(TestTree, { path: DETAIL.path, tests: TESTS, verdicts, failing }));

describe("the tests by domain", () => {
  it("count the tests of each domain, those without one last, and mark those whose last run did not simply pass", () => {
    assert.match(
      textOf(tree()),
      /^Tests par domaine Tous · 4 Échoués · 1 policies 2 Display the detail of a policy Échoué Compare the edit form of a policy Sans domaine 2 /,
    );
    assert.match(textOf(tree()), /Customer Management answers Instable/);
    // The domain of the test shown is unfolded, and the test marked.
    assert.equal(tree().match(/<details open="">/g)?.length, 1);
    assert.match(tree(), /aria-current="page"><span class="grow">Display the detail/);
  });

  it("put the domains in the order of their names", () => {
    const tests = [SCREEN, { ...SMOKE, domain: "customers" }];
    const html = render(createElement(TestTree, { path: DETAIL.path, tests, verdicts: [], failing: false }));
    assert.match(textOf(html), / customers 1 Customer Management answers policies 1 Compare/);
  });

  it("show those whose last run failed, each leading to its card in the same view, or say none did", () => {
    const html = tree(true);
    assert.match(textOf(html), / policies 1 Display the detail of a policy Échoué$/);
    assert.equal(linksOf(html).at(-1), `#/tests/view?path=${encodeURIComponent(DETAIL.path)}&tree=failing`);
    assert.match(textOf(tree(true, [])), /Échoués · 0 Aucun test n’a échoué à son dernier passage\.$/);
  });
});
