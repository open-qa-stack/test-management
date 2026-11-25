import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { Logger } from "@nestjs/common";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { sessionsApi, type TestApi } from "./sessions-api.ts";

/** What a test is given: its API, the folder of its test repository and the database they run on. */
export interface Started {
  readonly api: TestApi;
  readonly repository: string;
  readonly database: SessionDatabase;
}

/**
 * Gives the tests that call it an API over a database of the engine, on a test repository of its own: the
 * database is created once and cleared before each test, the API and the repository are started before each
 * test and removed after it.
 *
 * @param engine - The database the API runs on.
 * @param name - What the folder of the test repository is named after.
 * @param configuration - The text of the `oqas.json` the test repository holds.
 * @param started - Told, before each test, what was started.
 */
export function apiOverDatabase(engine: DatabaseEngine, name: string, configuration: string, started: (started: Started) => void): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  beforeAll(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), `oqas-api-${name}-`));
    writeFileSync(join(repository, "oqas.json"), configuration);
    api = await sessionsApi({ database: database.url, repository });
    started({ api, repository, database });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  afterAll(() => database.drop());
}
