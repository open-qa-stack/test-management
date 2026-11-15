import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { sharedFixtures } from "@open-qa-stack/shared";
import { ensureFixtures, fixturesFor, PLAYWRIGHT_ALONE } from "../src/designer/test-fixtures.ts";

const roots: string[] = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** An empty test repository. */
function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "test-fixtures-"));
  roots.push(root);
  return root;
}

describe("the file of the fixtures the tests of a repository share", () => {
  it("is written when the repository has none, with a tab for each application", async () => {
    const root = repository();
    assert.deepEqual(await ensureFixtures(root, "apps", ["shop", "customer-desk"]), {
      path: "apps/fixtures.ts",
      tabs: ["shopPage", "customerDeskPage"],
      created: true,
    });
    assert.equal(readFileSync(join(root, "apps", "fixtures.ts"), "utf8"), sharedFixtures(["shop", "customer-desk"]));
  });

  it("is kept as it is when the repository has one, and gives only the tabs it names", async () => {
    const root = repository();
    mkdirSync(join(root, "tests"));
    const own = sharedFixtures(["shop"]).replace("export { expect };", "export { expect };\n// customerDeskPages are not given.");
    writeFileSync(join(root, "tests", "fixtures.ts"), own);
    assert.deepEqual(await ensureFixtures(root, "tests", ["shop", "customer-desk"]), { path: "tests/fixtures.ts", tabs: ["shopPage"], created: false });
    assert.equal(readFileSync(join(root, "tests", "fixtures.ts"), "utf8"), own);
  });
});

describe("what a test is given by the fixtures", () => {
  const file = { path: "apps/fixtures.ts", tabs: ["shopPage"], created: false };

  it("is the module of the file, relative to the folder of the test, with its tabs", () => {
    assert.deepEqual(fixturesFor("apps/shop/orders/list.spec.ts", file), { module: "../../fixtures.ts", tabs: ["shopPage"] });
    assert.deepEqual(fixturesFor("apps/list.spec.ts", file), { module: "./fixtures.ts", tabs: ["shopPage"] });
  });

  it("is Playwright alone in a repository without the file", () => {
    assert.equal(fixturesFor("apps/shop/list.spec.ts", undefined), PLAYWRIGHT_ALONE);
    assert.deepEqual(PLAYWRIGHT_ALONE, { module: "@playwright/test", tabs: [] });
  });
});
