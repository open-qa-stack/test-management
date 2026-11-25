import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { Logger } from "@nestjs/common";
import { ExecutionStore } from "@open-qa-stack/store";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { Execution, ExecutionList, Problem } from "@open-qa-stack/domain/sessions";

/** An execution of a session of design, with one test that passed and one that failed. */
const EARLIER: Execution = {
  id: "e1",
  origin: "design",
  ranAt: "2026-11-19T09:00:00.000Z",
  commit: "4f2a9c01d3",
  environment: "local",
  report: ".oqas/runs/run-2026-11-19T09-00-00-000Z/report.json",
  results: [
    { path: "apps/shop/tests/orders/search.spec.ts", title: "Search an order", project: "shop", verdict: "passed", durationMs: 120, fileDigest: "ab12" },
    {
      path: "apps/shop/tests/orders/search.spec.ts",
      title: "Orders › Filter by date",
      project: "shop",
      verdict: "failed",
      durationMs: 300,
      failure: { step: { number: 2, title: "Filter by date" }, message: "Error: expect(locator).toHaveText(expected) failed", expected: "3", received: "0" },
    },
  ],
};

/** A later execution, of a test repository without a commit. */
const LATER: Execution = {
  id: "e2",
  origin: "design",
  ranAt: "2026-11-19T10:00:00.000Z",
  report: ".oqas/runs/run-2026-11-19T10-00-00-000Z/report.json",
  results: [],
};

/**
 * The tests of the route of the executions of tests over a database, written once for every database the store supports.
 *
 * @param engine - The database to run them on.
 */
export function executionsApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  beforeAll(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-executions-"));
    writeFileSync(join(repository, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/"));
    api = await sessionsApi({ database: database.url, repository });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  afterAll(() => database.drop());

  describe(`the executions of tests on ${engine.name}`, () => {
    it("are none until one is kept", async () => {
      const response = await fetch(`${api.url}/executions`);
      assert.deepEqual([response.status, response.headers.get("cache-control")], [200, "no-store"]);
      assert.deepEqual((await response.json()) as ExecutionList, { items: [], total: 0, start: 0 });
    });

    it("are served the latest first, each with what came of each of its tests and the version it ran at", async () => {
      const store = new ExecutionStore(database.database);
      await store.add(EARLIER);
      await store.add(LATER);
      assert.deepEqual((await (await fetch(`${api.url}/executions`)).json()) as ExecutionList, { items: [LATER, EARLIER], total: 2, start: 0 });
    });

    it("are served a page at a time, and by what came of their tests", async () => {
      const store = new ExecutionStore(database.database);
      await store.add(EARLIER);
      await store.add(LATER);
      const read = async (query: string) => (await (await fetch(`${api.url}/executions?${query}`)).json()) as ExecutionList;
      assert.deepEqual(
        [
          await read("limit=1"),
          await read("limit=1&before=e2"),
          await read("outcome=failing"),
          await read("outcome=passing"),
          await read("origin=design"),
          await read("origin=manual"),
          await read("campaign=c1"),
          await read("since=2026-11-19T09:30:00%2B00:00"),
          await read("since=2026-11-19"),
        ],
        [
          { items: [LATER], total: 2, start: 0, next: "e2" },
          { items: [EARLIER], total: 2, start: 1 },
          { items: [EARLIER], total: 1, start: 0 },
          { items: [LATER], total: 1, start: 0 },
          { items: [LATER, EARLIER], total: 2, start: 0 },
          { items: [], total: 0, start: 0 },
          { items: [], total: 0, start: 0 },
          { items: [LATER], total: 1, start: 0 },
          { items: [LATER, EARLIER], total: 2, start: 0 },
        ],
      );
    });

    it("are served one by its identifier, and say why a query is refused", async () => {
      await new ExecutionStore(database.database).add(EARLIER);
      const one = await fetch(`${api.url}/executions/e1`);
      assert.deepEqual([one.status, one.headers.get("cache-control"), await one.json()], [200, "no-store", EARLIER]);
      for (const [query, status, code] of [
        ["/e9", 404, "unknown_execution"],
        ["?before=e9", 404, "unknown_execution"],
        ["?before=", 400, "invalid_request"],
        ["?limit=0", 400, "invalid_request"],
        ["?limit=101", 400, "invalid_request"],
        ["?limit=a", 400, "invalid_request"],
        ["?outcome=flaky", 400, "invalid_request"],
        ["?origin=robot", 400, "invalid_request"],
        ["?campaign=", 400, "invalid_request"],
        ["?since=yesterday", 400, "invalid_request"],
        ["?since=2026-13-40", 400, "invalid_request"],
      ] as const) {
        const answer = await fetch(`${api.url}/executions${query}`);
        assert.deepEqual([query, answer.status, ((await answer.json()) as Problem).code], [query, status, code]);
      }
    });

    it("hold the runs the test repository ran before, once the API starts again", async () => {
      const folder = join(repository, ".oqas", "runs", "run-2026-11-18T22-15-30-250Z");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "report.json"), JSON.stringify({ suites: [] }));
      await api.close();
      api = await sessionsApi({ database: database.url, repository });
      assert.deepEqual((await (await fetch(`${api.url}/executions`)).json()) as ExecutionList, {
        items: [
          {
            id: "run-2026-11-18T22-15-30-250Z",
            origin: "design",
            ranAt: "2026-11-18T22:15:30.250Z",
            report: ".oqas/runs/run-2026-11-18T22-15-30-250Z/report.json",
            results: [],
          },
        ],
        total: 1,
        start: 0,
      });
    });
  });
}
