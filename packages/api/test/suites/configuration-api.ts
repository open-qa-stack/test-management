import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { Logger } from "@nestjs/common";
import { configurationText, type OqasConfig } from "@open-qa-stack/domain";
import { SessionDatabase, type DatabaseEngine } from "@open-qa-stack/store/testing";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "../support/sessions-api.ts";
import type { ConfigurationCheck, ConfigurationView, Problem, RevisionList } from "@open-qa-stack/domain/sessions";

/** The configuration of the test repository, as its file first holds it. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/");

/** That configuration, read. */
const DOCUMENT = JSON.parse(TEXT) as OqasConfig;

/** The same configuration, with the levels of the design changed. */
const CHANGED = { ...DOCUMENT, design: { ...DOCUMENT.design, levels: ["smoke", "functional"] } } as OqasConfig;

/** An answer of the API: its status, its media type, its cache policy and its body. */
interface Answer {
  readonly status: number;
  readonly type: string | null;
  readonly cache: string | null;
  readonly body: unknown;
}

async function answerOf(response: Response): Promise<Answer> {
  return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"), body: await response.json() };
}

/**
 * The tests of the routes of the configuration over a database, written once for every database the store
 * supports.
 *
 * @param engine - The database to run them on.
 */
export function configurationApiSuite(engine: DatabaseEngine): void {
  let database: SessionDatabase;
  let repository: string;
  let api: TestApi;
  before(async () => {
    database = await SessionDatabase.create(engine, new Logger("Database"));
  });
  beforeEach(async () => {
    await database.clear();
    repository = mkdtempSync(join(tmpdir(), "oqas-api-configuration-"));
    writeFileSync(join(repository, "oqas.json"), TEXT);
    api = await sessionsApi({ database: database.url, repository });
  });
  afterEach(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });
  after(() => database.drop());

  const get = async (path: string, on = api) => answerOf(await fetch(`${on.url}/configuration${path}`));
  const post = async (path: string, body?: unknown, on = api) =>
    answerOf(
      await fetch(`${on.url}/configuration${path}`, {
        method: "POST",
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      }),
    );
  const fileText = () => readFileSync(join(repository, "oqas.json"), "utf8");
  const problemCode = (answer: Answer) => `${answer.status} ${(answer.body as Problem).code}`;

  describe(`the configuration of an instance on ${engine.name}`, () => {
    it("is the file of the test repository, taken as the first revision when the API started, and read as it is now", async () => {
      const read = await get("");
      assert.deepEqual([read.status, read.type, read.cache], [200, "application/json; charset=utf-8", "no-store"]);
      const { revision, file } = read.body as ConfigurationView;
      assert.deepEqual([revision?.number, revision?.origin, revision?.document, file], [1, "file", DOCUMENT, "in_step"]);
      const listed = await get("/revisions");
      assert.deepEqual([listed.status, listed.cache], [200, "no-store"]);
      assert.deepEqual(
        (listed.body as RevisionList).items.map(({ number, origin }) => `${number} ${origin}`),
        ["1 file"],
      );
    });

    it("is checked without anything recorded, each error where it is", async () => {
      const valid = await post("/validation", DOCUMENT);
      assert.deepEqual([valid.status, valid.body], [200, { errors: [] } satisfies ConfigurationCheck]);
      const wrong = await post("/validation", { ...DOCUMENT, design: { levels: [] } });
      assert.deepEqual(
        [wrong.status, (wrong.body as ConfigurationCheck).errors.map(({ path, rule }) => `${path} ${rule}`)],
        [200, ["/design/levels too-few-items"]],
      );
      assert.equal(problemCode(await post("/validation", [DOCUMENT])), "400 invalid_request");
      assert.equal(((await get("/revisions")).body as RevisionList).items.length, 1);
    });

    it("is changed from the revision in force, which rewrites the file in the order of the schema", async () => {
      const saved = await post("/revisions", { basedOn: 1, document: CHANGED });
      assert.equal(saved.status, 201);
      const { revision, file } = saved.body as ConfigurationView;
      assert.deepEqual([revision?.number, revision?.origin, revision?.document, file], [2, "console", CHANGED, "in_step"]);
      assert.equal(fileText(), configurationText(CHANGED));
      assert.deepEqual(
        ((await get("/revisions")).body as RevisionList).items.map(({ number, origin }) => `${number} ${origin}`),
        ["2 console", "1 file"],
      );
    });

    it("refuses a change made from a revision another replaced since, one that is not valid, and one a client cannot send", async () => {
      await post("/revisions", { basedOn: 1, document: CHANGED });
      const stale = await post("/revisions", { basedOn: 1, document: DOCUMENT });
      assert.equal(problemCode(stale), "409 stale_revision");
      const invalid = await post("/revisions", { basedOn: 2, document: { ...CHANGED, applications: [] } });
      assert.equal(problemCode(invalid), "422 invalid_configuration");
      assert.deepEqual(
        (invalid.body as Problem).errors?.map(({ path, rule }) => `${path} ${rule}`),
        ["/applications too-few-items"],
      );
      assert.equal(invalid.type, "application/problem+json; charset=utf-8");
      assert.equal(problemCode(await post("/revisions", { basedOn: 2 })), "400 invalid_request");
      assert.equal(fileText(), configurationText(CHANGED));
    });

    it("refuses a change when the file changed too, and leaves the two ways out: keep the file, or keep the change over it", async () => {
      writeFileSync(join(repository, "oqas.json"), JSON.stringify(CHANGED, null, 4));
      assert.equal(((await get("")).body as ConfigurationView).file, "changed");
      const conflict = await post("/revisions", { basedOn: 1, document: DOCUMENT });
      assert.equal(problemCode(conflict), "409 configuration_conflict");
      assert.match((conflict.body as Problem).detail, /POST \/api\/configuration\/synchronisation .* "replaceFile": true/);
      const kept = await post("/synchronisation");
      assert.equal(kept.status, 200);
      const taken = kept.body as ConfigurationView;
      assert.deepEqual([taken.revision?.number, taken.revision?.origin, taken.revision?.document, taken.file], [2, "file", CHANGED, "in_step"]);
      writeFileSync(join(repository, "oqas.json"), "{}");
      const replaced = await post("/revisions", { basedOn: 2, document: DOCUMENT, replaceFile: true });
      assert.deepEqual([replaced.status, (replaced.body as ConfigurationView).revision?.number, fileText()], [201, 3, configurationText(DOCUMENT)]);
    });

    it("refuses to take a file that is not valid, the revision in force kept", async () => {
      writeFileSync(join(repository, "oqas.json"), "{");
      const refused = await post("/synchronisation");
      assert.equal(problemCode(refused), "422 invalid_configuration");
      assert.deepEqual((refused.body as Problem).errors, [{ kind: "syntax", path: "", rule: "json", message: "The file is not valid JSON." }]);
      assert.equal(((await get("")).body as ConfigurationView).revision?.number, 1);
    });

    it("is read and changed by none on an API that was given no test repository, which has none of its own before one is saved", async () => {
      await api.close();
      await database.clear();
      api = await sessionsApi({ database: database.url });
      assert.deepEqual((await get("")).body, { file: "missing" } satisfies ConfigurationView);
      assert.equal(problemCode(await post("/synchronisation")), "404 no_configuration");
      const refused = await post("/revisions", { basedOn: 0, document: DOCUMENT });
      assert.equal(problemCode(refused), "503 unavailable");
      assert.match((refused.body as Problem).detail, /changes no configuration/);
    });
  });
}
