import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { RepositoryTest } from "@open-qa-stack/domain/sessions";
import { EVERY_TEST, facetsOf, filteredTests, sameChoice, testKey, testsOfChoice } from "../../src/campaigns/campaign-composition.ts";

/** A test of the repository, as its listing gives it. */
const listed = (path: string, title: string, more: Partial<RepositoryTest> = {}): RepositoryTest => ({
  path,
  title,
  steps: [],
  tags: [],
  applications: [],
  ...more,
});

const HOME = listed("apps/policies/home.spec.ts", "Open the policies", {
  level: "smoke",
  domain: "policies",
  applications: ["policies"],
  tags: ["@level-smoke"],
});
const QUOTE = listed("apps/policies/quote.spec.ts", "Answer a quote", {
  level: "functional",
  domain: "quotes",
  applications: ["policies", "portal"],
  tags: ["@p0"],
});
const LOGIN = listed("apps/portal/login.spec.ts", "Log in");
const TESTS = [HOME, QUOTE, LOGIN];

describe("the composition of a campaign", () => {
  it("names a test by the path of its file and its title, and gives back the tests of a choice from their keys", () => {
    assert.equal(testKey(HOME), "apps/policies/home.spec.ts\nOpen the policies");
    assert.deepEqual(testsOfChoice(new Set([testKey(QUOTE), testKey({ path: "a.spec.ts", title: "Two\nlines" })])), [
      { path: QUOTE.path, title: QUOTE.title },
      { path: "a.spec.ts", title: "Two\nlines" },
    ]);
  });

  it("offers the levels, domains, applications and tags the tests bear, each once and in order", () => {
    assert.deepEqual(facetsOf(TESTS), {
      levels: ["functional", "smoke"],
      domains: ["policies", "quotes"],
      applications: ["policies", "portal"],
      tags: ["@level-smoke", "@p0"],
    });
  });

  it("keeps the tests every criterion of the filter keeps: words of the title or the path, level, domain, application, tag, the choice", () => {
    const keep = (filter: Partial<typeof EVERY_TEST>, chosen: readonly RepositoryTest[] = []) =>
      filteredTests(TESTS, { ...EVERY_TEST, ...filter }, new Set(chosen.map(testKey))).map(({ title }) => title);
    assert.deepEqual(keep({}), ["Open the policies", "Answer a quote", "Log in"]);
    assert.deepEqual(keep({ words: "  QUOTE " }), ["Answer a quote"]);
    assert.deepEqual(keep({ words: "portal/" }), ["Log in"]);
    assert.deepEqual(keep({ level: "smoke" }), ["Open the policies"]);
    assert.deepEqual(keep({ domain: "quotes" }), ["Answer a quote"]);
    assert.deepEqual(keep({ application: "policies" }), ["Open the policies", "Answer a quote"]);
    assert.deepEqual(keep({ tag: "@p0" }), ["Answer a quote"]);
    assert.deepEqual(keep({ chosenOnly: true }, [LOGIN]), ["Log in"]);
  });

  it("tells whether two choices hold the same tests, whatever their order", () => {
    assert.ok(sameChoice(new Set(["a", "b"]), new Set(["b", "a"])));
    assert.ok(!sameChoice(new Set(["a"]), new Set(["a", "b"])));
    assert.ok(!sameChoice(new Set(["a", "c"]), new Set(["a", "b"])));
  });
});
