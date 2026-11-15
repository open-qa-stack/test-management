import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { sharedFixtures } from "@open-qa-stack/shared";
import { ensureFixtures, fixturesFor, PLAYWRIGHT_ALONE } from "../src/designer/test-fixtures.ts";
import { WrittenFiles } from "../src/designer/written-files.ts";

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
  it("is written when the repository has none, with each application, and is one of the files the design wrote", async () => {
    const root = repository();
    const written = new WrittenFiles(root);
    assert.deepEqual(await ensureFixtures(root, "apps/fixtures.ts", "apps", ["shop", "customer-desk"], written), {
      path: "apps/fixtures.ts",
      applications: ["shop", "customer-desk"],
    });
    assert.equal(readFileSync(join(root, "apps", "fixtures.ts"), "utf8"), sharedFixtures(["shop", "customer-desk"]));
    assert.deepEqual(written.paths, ["apps/fixtures.ts"]);
  });

  it("is kept as it is when the repository has one, and gives only the applications it names", async () => {
    const root = repository();
    mkdirSync(join(root, "tests"));
    const own = sharedFixtures(["shop"]).replace("export { expect };", "export { expect };\n// customerDesk is not given, customerDeskPage neither.");
    writeFileSync(join(root, "tests", "fixtures.ts"), own);
    const written = new WrittenFiles(root);
    assert.deepEqual(await ensureFixtures(root, "tests/fixtures.ts", "tests", ["shop", "customer-desk"], written), {
      path: "tests/fixtures.ts",
      applications: ["shop"],
    });
    assert.deepEqual([readFileSync(join(root, "tests", "fixtures.ts"), "utf8"), written.paths], [own, []]);
  });
});

describe("what a test is given by the fixtures", () => {
  const file = { path: "apps/fixtures.ts", applications: ["shop"] };

  it("is the module of the file, relative to the folder of the test, with its applications", () => {
    assert.deepEqual(fixturesFor("apps/shop/orders/list.spec.ts", file), { module: "../../fixtures.ts", applications: ["shop"] });
    assert.deepEqual(fixturesFor("apps/list.spec.ts", file), { module: "./fixtures.ts", applications: ["shop"] });
  });

  it("is Playwright alone in a repository without the file", () => {
    assert.equal(fixturesFor("apps/shop/list.spec.ts", undefined), PLAYWRIGHT_ALONE);
    assert.deepEqual(PLAYWRIGHT_ALONE, { module: "@playwright/test", applications: [] });
  });
});
