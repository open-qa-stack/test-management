import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Logger } from "@nestjs/common";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { RepositoryTestList } from "@open-qa-stack/domain/sessions";

/** A test of the shop as a design writes it: a title, tags, and two steps. */
const SEARCH = [
  'import { expect, test } from "../../../../shared/fixtures.ts";',
  "",
  'test("Search an order by its number", { tag: ["@level-functional", "@domain-orders", "@feature-search", "@app-shop", "@kind-functional", "@case-nominal", "@data-read"] }, async ({ page }) => {',
  '  await test.step("1. Open the orders", async () => {});',
  '  await test.step("2. Search ORD-1042", async () => {});',
  "});",
  "",
].join("\n");

/**
 * The tests of the route of the tests of the test repository over a database, written once for every database the
 * store supports: the configuration in force, which names the folder of the applications, is in the database.
 *
 * @param engine - The database to run them on.
 */
export function testsApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  before(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-tests-"));
    writeFileSync(join(repository, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/"));
    const folder = join(repository, "apps", "shop", "tests", "orders", "search");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "search-orders.spec.ts"), SEARCH);
    // A file beside the tests that is no test, such as a page object, is no test of the repository.
    writeFileSync(join(folder, "orders.page.ts"), "export class Orders {}\n");
    api = await sessionsApi({ database: database.url, repository });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  after(() => database.drop());

  describe(`the tests of the test repository on ${engine.name}`, () => {
    it("are read from their files as they are now, each with what its tags say of it, which no cache keeps", async () => {
      const response = await fetch(`${api.url}/tests`);
      assert.deepEqual([response.status, response.headers.get("cache-control")], [200, "no-store"]);
      assert.deepEqual((await response.json()) as RepositoryTestList, {
        items: [
          {
            path: "apps/shop/tests/orders/search/search-orders.spec.ts",
            title: "Search an order by its number",
            steps: ["1. Open the orders", "2. Search ORD-1042"],
            tags: ["@level-functional", "@domain-orders", "@feature-search", "@app-shop", "@kind-functional", "@case-nominal", "@data-read"],
            applications: ["shop"],
            level: "functional",
            domain: "orders",
            feature: "search",
            kind: "functional",
            case: "nominal",
            data: "read",
          },
        ],
      });
    });
  });
}
