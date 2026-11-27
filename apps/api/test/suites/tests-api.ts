import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { Logger } from "@nestjs/common";
import { ExecutionStore } from "@open-qa-stack/store";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type {
  Problem,
  RepositoryTest,
  RepositoryTestList,
  TestExecutionList,
  TestSource,
  LastVerdictList,
  TestVersionList,
  TestReading,
} from "@open-qa-stack/domain/sessions";

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
  beforeAll(async () => {
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
  afterAll(() => database.drop());

  describe(`the tests of the test repository on ${engine.name}`, () => {
    it("are decided of by a body that is a decision, and a test no design gave is not found", async () => {
      const decide = (body: unknown) =>
        fetch(`${api.url}/reviews/11111111-1111-4111-8111-111111111111/decision`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      const invalid = await decide({ status: "approved" });
      assert.deepEqual([invalid.status, ((await invalid.json()) as Problem).code], [400, "invalid_request"]);
      const unknown = await decide({ status: "validated" });
      assert.deepEqual([unknown.status, ((await unknown.json()) as Problem).code], [404, "unknown_proposal"]);
    });

    it("waiting for a review are none without a design, and a test no design gave is not found", async () => {
      const queue = await fetch(`${api.url}/reviews`);
      assert.deepEqual(
        [queue.status, queue.headers.get("cache-control"), await queue.json()],
        [200, "no-store", { tests: [], counts: { inReview: 0, setAside: 0 } }],
      );
      const unknown = await fetch(`${api.url}/reviews/11111111-1111-4111-8111-111111111111`);
      assert.equal(unknown.status, 404);
      assert.match(
        ((await unknown.json()) as Problem).detail,
        /^No test the agents wrote bears the identifier 11111111-1111-4111-8111-111111111111\. List the tests to review with GET \/reviews\.$/,
      );
    });

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
        anomalies: [],
      });
    });

    it("are listed one per test of a file, and tell a title two tests of a file share", async () => {
      const folder = join(repository, "apps", "shop", "tests", "orders", "detail");
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        join(folder, "detail.spec.ts"),
        'test("Open an order", async () => {});\ntest("Close an order", async () => {});\ntest("Close an order", async () => {});\n',
      );
      const listed = (await (await fetch(`${api.url}/tests`)).json()) as RepositoryTestList;
      assert.deepEqual(
        listed.items.map(({ path, title }) => `${path.replace("apps/shop/tests/orders/", "")} ${title}`),
        ["detail/detail.spec.ts Open an order", "detail/detail.spec.ts Close an order", "search/search-orders.spec.ts Search an order by its number"],
      );
      assert.deepEqual(listed.anomalies, [{ kind: "duplicate", path: "apps/shop/tests/orders/detail/detail.spec.ts", title: "Close an order" }]);
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
        attachments: [
          { name: "1", contentType: "image/png", body: Buffer.from("png").toString("base64") },
          { name: "trace", contentType: "application/zip", path: join(run, "trace.zip") },
        ],
      };
      writeFileSync(join(run, "trace.zip"), "zip");
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
      // The trace the run kept of the test is served as an archive, and none of a test it did not run.
      const trace = await fetch(`${api.url}/tests/trace?path=${encodeURIComponent(path)}`);
      assert.deepEqual(
        [
          trace.status,
          trace.headers.get("content-type"),
          trace.headers.get("cache-control"),
          Buffer.from(await trace.arrayBuffer()).toString(),
          read.body.traced,
        ],
        [200, "application/zip", "no-store", "zip", true],
      );
      const untraced = await fetch(`${api.url}/tests/trace?path=${encodeURIComponent("apps/shop/tests/other.spec.ts")}`);
      assert.deepEqual([untraced.status, ((await untraced.json()) as Problem).code], [404, "unknown_trace"]);
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
      // What came of each test the last time it ran is told, a test skipped aside.
      const verdicts = await fetch(`${api.url}/tests/verdicts`);
      assert.deepEqual([verdicts.status, verdicts.headers.get("cache-control")], [200, "no-store"]);
      assert.deepEqual(
        ((await verdicts.json()) as LastVerdictList).items,
        results.map(({ path: of, title, verdict }) => ({ path: of, title, verdict })),
      );
      // The versions of the tests of the file are told the latest first, numbered by the digest of each test.
      await new ExecutionStore(database.database).add({
        id: "e2",
        origin: "design",
        ranAt: "2026-11-19T09:00:00.000Z",
        commit: "4f2a9c0",
        report: ".oqas/runs/run-2026-11-19T09-00-00-000Z/report.json",
        results: [{ ...results[0], testDigest: "d1", committed: true }],
      });
      const versions = await fetch(`${api.url}/tests/versions?path=${encodeURIComponent(path)}`);
      assert.deepEqual(
        [versions.status, versions.headers.get("cache-control"), (await versions.json()) as TestVersionList],
        [
          200,
          "no-store",
          { items: [{ path, title: spec.title, number: 1, digest: "d1", commit: "4f2a9c0", since: "2026-11-19T09:00:00.000Z", executions: 1 }] },
        ],
      );
      for (const route of ["executions", "versions"]) {
        const unnamed = await fetch(`${api.url}/tests/${route}`);
        assert.deepEqual([route, unnamed.status, ((await unnamed.json()) as Problem).code], [route, 400, "invalid_request"]);
      }
    });

    it("give the code of a test, change its title and its steps in its file, and keep its history under its identifier", async () => {
      const path = "apps/shop/tests/orders/search/search-orders.spec.ts";
      const title = "Search an order by its number";
      const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
      git("init", "-q", "-b", "main");
      git("-c", "user.name=Tester", "-c", "user.email=tester@example.com", "commit", "-q", "--allow-empty", "-m", "test: start");
      git("config", "user.name", "Tester");
      git("config", "user.email", "tester@example.com");
      // A file not committed yet cannot be committed alone.
      const uncommitted = await fetch(`${api.url}/tests`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, title, change: { title: "Find an order by its number" } }),
      });
      assert.deepEqual(
        [uncommitted.status, ((await uncommitted.json()) as Problem).detail],
        [422, `${path} has changes that are not committed: commit them or drop them first.`],
      );
      git("add", "-A");
      git("commit", "-q", "-m", "test: add the search");
      const source = await fetch(`${api.url}/tests/source?path=${encodeURIComponent(path)}`);
      assert.deepEqual([source.status, source.headers.get("cache-control"), (await source.json()) as TestSource], [200, "no-store", { path, content: SEARCH }]);
      await new ExecutionStore(database.database).add({
        id: "e1",
        origin: "design",
        ranAt: "2026-11-19T08:00:00.000Z",
        report: ".oqas/runs/run-2026-11-19T08-00-00-000Z/report.json",
        results: [{ path, title, project: "shop", verdict: "passed", durationMs: 20, testDigest: "d1" }],
      });
      const change = (body: unknown) =>
        fetch(`${api.url}/tests`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const renamed = await change({ path, title, change: { title: "Find an order by its number" } });
      const test = (await renamed.json()) as RepositoryTest;
      assert.deepEqual([renamed.status, test.title, test.steps], [200, "Find an order by its number", ["1. Open the orders", "2. Search ORD-1042"]]);
      assert.match(test.id!, /^[0-9a-f-]{36}$/);
      assert.ok(readFileSync(join(repository, path), "utf8").includes(`"@data-read", "@oqas-id-${test.id}"] }`));
      assert.equal(git("log", "-1", "--format=%s").trim(), 'test: rename "Search an order by its number" to "Find an order by its number"');
      // The versions and the results of the test follow it under its new title.
      const versions = (await (await fetch(`${api.url}/tests/versions?path=${encodeURIComponent(path)}`)).json()) as TestVersionList;
      const executions = (await (await fetch(`${api.url}/tests/executions?path=${encodeURIComponent(path)}`)).json()) as TestExecutionList;
      assert.deepEqual([versions.items.map((version) => version.title), executions.items.map(({ result }) => result.title)], [[test.title], [test.title]]);
      const stepped = (await (await change({ path, title: test.title, change: { step: 2, text: "Search the order ORD-1042" } })).json()) as RepositoryTest;
      assert.deepEqual([stepped.id, stepped.steps[1]], [test.id, "2. Search the order ORD-1042"]);
      const refusals: [unknown, number, string][] = [
        [{ path, title: "Close an order", change: { title: "B" } }, 404, "unknown_test"],
        [{ path, title: test.title, change: { step: 3, text: "Close" } }, 422, "test_change_refused"],
        [{ path, title: test.title, change: { title: "" } }, 422, "test_change_refused"],
        [{ path, title: test.title, change: { step: 0, text: "Close" } }, 400, "invalid_request"],
        [{ path, title: test.title, change: { title: "B", step: 1 } }, 400, "invalid_request"],
        [{ path, title: test.title }, 400, "invalid_request"],
        [{ path }, 400, "invalid_request"],
        [[], 400, "invalid_request"],
      ];
      for (const [body, status, code] of refusals) {
        const answer = await change(body);
        assert.deepEqual([JSON.stringify(body), answer.status, ((await answer.json()) as Problem).code], [JSON.stringify(body), status, code]);
      }
      const unknown = await fetch(`${api.url}/tests/source?path=${encodeURIComponent("apps/shop/tests/orders/search/orders.page.ts")}`);
      assert.deepEqual([unknown.status, ((await unknown.json()) as Problem).code], [404, "unknown_test"]);
      const unnamed = await fetch(`${api.url}/tests/source`);
      assert.deepEqual([unnamed.status, ((await unnamed.json()) as Problem).code], [400, "invalid_request"]);
    });
  });
}
