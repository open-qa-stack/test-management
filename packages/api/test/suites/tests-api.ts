import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Logger } from "@nestjs/common";
import { ExecutionStore } from "@open-qa-stack/store";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { Problem, RepositoryTestList, TestExecutionList, TestReading } from "@open-qa-stack/domain/sessions";

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

    it("are read in steps from the latest run that ran them, each step with its capture, and say why a capture or a query is refused", async () => {
      const path = "apps/shop/tests/orders/search/search-orders.spec.ts";
      const reading = async (query: string) => {
        const response = await fetch(`${api.url}/tests/reading?${query}`);
        return { status: response.status, cache: response.headers.get("cache-control"), body: (await response.json()) as TestReading & Problem };
      };
      assert.deepEqual(await reading(`path=${encodeURIComponent(path)}`), { status: 200, cache: "no-store", body: { path } });
      const run = join(repository, ".oqas", "runs", "run-2026-11-19T08-00-00-000Z");
      mkdirSync(run, { recursive: true });
      const spec = { title: "Search an order by its number", file: "shop/tests/orders/search/search-orders.spec.ts", line: 3 };
      const result = {
        status: "passed",
        steps: [{ title: "1. Open the orders", duration: 20 }],
        attachments: [{ name: "1", contentType: "image/png", body: Buffer.from("png").toString("base64") }],
      };
      writeFileSync(
        join(run, "report.json"),
        JSON.stringify({
          suites: [
            {
              title: spec.file,
              file: spec.file,
              specs: [{ ...spec, tests: [{ projectName: "shop", status: "expected", expectedStatus: "passed", results: [result] }] }],
            },
          ],
        }),
      );
      const read = await reading(`path=${encodeURIComponent(path)}`);
      assert.deepEqual(
        [read.body.run, read.body.view?.steps.map((step) => [step.number, step.title, step.capture?.name])],
        ["run-2026-11-19T08-00-00-000Z", [[1, "1. Open the orders", "1"]]],
      );
      const capture = await fetch(`${api.url}/tests/capture?path=${encodeURIComponent(path)}&step=1`);
      assert.deepEqual([capture.status, capture.headers.get("content-type"), Buffer.from(await capture.arrayBuffer()).toString()], [200, "image/png", "png"]);
      const missing = await fetch(`${api.url}/tests/capture?path=${encodeURIComponent(path)}&step=2`);
      assert.deepEqual([missing.status, ((await missing.json()) as Problem).code], [404, "unknown_capture"]);
      for (const query of [
        "",
        "path=",
        `path=${encodeURIComponent(path)}&step=0`,
        `path=${encodeURIComponent(path)}&step=a`,
        `path=${encodeURIComponent(path)}&execution=`,
      ]) {
        const answer = await fetch(`${api.url}/tests/${query.includes("step") ? "capture" : "reading"}?${query}`);
        assert.deepEqual([query, answer.status, ((await answer.json()) as Problem).code], [query, 400, "invalid_request"]);
      }
      // A reading and a capture come from the run of an execution the query names, and none from one the instance does not keep.
      const results = [{ path, title: spec.title, project: "shop", verdict: "passed", durationMs: 20 }] as const;
      await new ExecutionStore(database.database).add({
        id: "e1",
        origin: "design",
        ranAt: "2026-11-19T08:00:01.000Z",
        report: ".oqas/runs/run-2026-11-19T08-00-00-000Z/report.json",
        results,
      });
      const inExecution = await reading(`path=${encodeURIComponent(path)}&execution=e1`);
      assert.deepEqual([inExecution.body.run, inExecution.body.ranAt], ["run-2026-11-19T08-00-00-000Z", "2026-11-19T08:00:01.000Z"]);
      const kept = await fetch(`${api.url}/tests/capture?path=${encodeURIComponent(path)}&step=1&execution=e1`);
      assert.equal(Buffer.from(await kept.arrayBuffer()).toString(), "png");
      for (const route of ["reading", "capture"]) {
        const answer = await fetch(`${api.url}/tests/${route}?path=${encodeURIComponent(path)}&step=1&execution=e9`);
        assert.deepEqual([route, answer.status, ((await answer.json()) as Problem).code], [route, 404, "unknown_execution"]);
      }
      // The executions of the file are told the latest first, each with what came of its test.
      const executions = await fetch(`${api.url}/tests/executions?path=${encodeURIComponent(path)}`);
      assert.deepEqual(
        [executions.status, executions.headers.get("cache-control"), (await executions.json()) as TestExecutionList],
        [200, "no-store", { items: [{ id: "e1", origin: "design", ranAt: "2026-11-19T08:00:01.000Z", result: results[0] }] }],
      );
      const unnamed = await fetch(`${api.url}/tests/executions`);
      assert.deepEqual([unnamed.status, ((await unnamed.json()) as Problem).code], [400, "invalid_request"]);
    });
  });
}
