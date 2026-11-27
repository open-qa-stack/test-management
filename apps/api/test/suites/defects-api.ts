import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "vitest";
import { Logger } from "@nestjs/common";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import type { DefectList, ListedDefect, Problem } from "@open-qa-stack/domain/sessions";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";

const TEST = { path: "apps/shop/tests/orders/listing/list-orders.spec.ts", title: "The orders are listed" };

/**
 * The tests of the routes of the defects over a database, written once for every database the store supports.
 *
 * @param engine - The database to run them on.
 */
export function defectsApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  beforeAll(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-defects-"));
    writeFileSync(join(repository, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/"));
    api = await sessionsApi({ database: database.url, repository });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  afterAll(() => database.drop());

  /** Sends a body to a route of the defects. */
  const sent = (path: string, method: string, body: unknown) =>
    fetch(`${api.url}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  describe(`the defects on ${engine.name}`, () => {
    it("are reported, listed by view, and moved, which no cache keeps", async () => {
      const empty = await fetch(`${api.url}/defects`);
      assert.deepEqual(
        [empty.status, empty.headers.get("cache-control"), await empty.json()],
        [200, "no-store", { items: [], counts: { open: 0, toReplay: 0, closed: 0 } }],
      );
      const reported = await sent("/defects", "POST", { title: "The total is wrong", severity: "S2", description: "It shows 0.", test: TEST });
      const defect = (await reported.json()) as ListedDefect;
      assert.deepEqual([reported.status, defect.id, defect.stage], [201, "D-1", "open"]);
      const fixed = (await (await sent("/defects/D-1", "PATCH", { status: "fixed" })).json()) as ListedDefect;
      assert.deepEqual([fixed.status, fixed.stage], ["fixed", "to_replay"]);
      const listed = (await (await fetch(`${api.url}/defects`)).json()) as DefectList;
      assert.deepEqual(listed.counts, { open: 0, toReplay: 1, closed: 0 });
    });

    it("refuse a body that is no report or no change, and a defect the instance does not keep", async () => {
      const invalid = await sent("/defects", "POST", { title: "", severity: "S2", test: TEST });
      assert.deepEqual([invalid.status, ((await invalid.json()) as Problem).code], [400, "invalid_request"]);
      const change = await sent("/defects/D-1", "PATCH", { status: "done" });
      assert.deepEqual([change.status, ((await change.json()) as Problem).code], [400, "invalid_request"]);
      const unknown = await sent("/defects/D-9", "PATCH", { status: "fixed" });
      assert.deepEqual([unknown.status, ((await unknown.json()) as Problem).detail], [404, "The instance keeps no defect D-9. List them with GET /defects."]);
    });
  });
}
