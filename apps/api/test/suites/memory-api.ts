import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { Logger } from "@nestjs/common";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import type { MemoryItem, MemoryList, Problem } from "@open-qa-stack/domain/sessions";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";

/**
 * The tests of the routes of the memory of the agents over a database, written once for every database the store supports.
 *
 * @param engine - The database to run them on.
 */
export function memoryApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  beforeAll(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-memory-"));
    writeFileSync(join(repository, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/"));
    api = await sessionsApi({ database: database.url, repository });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  afterAll(() => database.drop());

  /** Sends a body to a route of the memory. */
  const sent = (path: string, method: string, body: unknown) =>
    fetch(`${api.url}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  describe(`the memory of the agents on ${engine.name}`, () => {
    it("keeps an instruction, lists it with how many are active and set aside, and changes it, which no cache keeps", async () => {
      const empty = await fetch(`${api.url}/memory`);
      assert.deepEqual(
        [empty.status, empty.headers.get("cache-control"), await empty.json()],
        [200, "no-store", { items: [], counts: { active: 0, inactive: 0 } }],
      );
      const added = await sent("/memory", "POST", { text: " Create customers by the API. ", application: "shop", target: "design" });
      const lesson = (await added.json()) as MemoryItem;
      assert.deepEqual(
        [added.status, lesson.type, lesson.text, lesson.application, lesson.target, lesson.active],
        [201, "instruction", "Create customers by the API.", "shop", "design", true],
      );
      const changed = (await (await sent(`/memory/${lesson.id}`, "PATCH", { active: false, application: null })).json()) as MemoryItem;
      assert.deepEqual([changed.active, changed.application], [false, undefined]);
      const listed = (await (await fetch(`${api.url}/memory`)).json()) as MemoryList;
      assert.deepEqual(listed.counts, { active: 0, inactive: 1 });
    });

    it("refuse a body that is no lesson or no change, and a line the instance does not keep", async () => {
      const invalid = await sent("/memory", "POST", { text: "x", target: "diagnosis" });
      assert.deepEqual([invalid.status, ((await invalid.json()) as Problem).code], [400, "invalid_request"]);
      const nothing = await sent("/memory/m1", "PATCH", {});
      assert.deepEqual([nothing.status, ((await nothing.json()) as Problem).code], [400, "invalid_request"]);
      const unknown = await sent("/memory/m1", "PATCH", { active: false });
      const problem = (await unknown.json()) as Problem;
      assert.deepEqual(
        [unknown.status, problem.code, problem.detail],
        [404, "unknown_memory", "The instance keeps no lesson nor memory m1. List them with GET /memory."],
      );
    });
  });
}
