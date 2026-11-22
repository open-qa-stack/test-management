import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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
  const put = async (path: string, on = api) => answerOf(await fetch(`${on.url}/configuration${path}`, { method: "PUT" }));
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

    it("tests a connection to the model as it is drafted: what the server answers, or that its key is not set, and nothing is recorded", async () => {
      const server = { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "" };
      const unreachable = await post("/model-connection", server);
      assert.deepEqual([unreachable.status, unreachable.cache, unreachable.body], [200, "no-store", { state: "unreachable", url: "http://127.0.0.1:9/v1" }]);
      const missing = await post("/model-connection", { ...server, apiKeyEnv: "OQAS_UNSET_KEY" });
      assert.deepEqual(missing.body, { state: "key-missing", variable: "OQAS_UNSET_KEY" });
      assert.equal(problemCode(await post("/model-connection", { mode: "github" })), "400 invalid_request");
      assert.equal(problemCode(await post("/model-connection", { ...server, baseUrl: "nowhere" })), "400 invalid_request");
      // A key typed and not saved yet is tried in place of the variable that holds none.
      const typed = await post("/model-connection", { ...server, apiKeyEnv: "OQAS_UNSET_KEY", key: "typed" });
      assert.deepEqual(typed.body, { state: "unreachable", url: "http://127.0.0.1:9/v1" });
      assert.equal(problemCode(await post("/model-connection", { ...server, key: 1 })), "400 invalid_request");
      assert.equal(problemCode(await post("/model-connection", "not an object")), "400 invalid_request");
      assert.equal(((await get("/revisions")).body as RevisionList).items.length, 1);
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

    it("is changed from the revision in force, which writes no file: the file then differs from it", async () => {
      const saved = await post("/revisions", { basedOn: 1, document: CHANGED });
      assert.equal(saved.status, 201);
      const { revision, file } = saved.body as ConfigurationView;
      assert.deepEqual([revision?.number, revision?.origin, revision?.document, file], [2, "console", CHANGED, "changed"]);
      assert.equal(fileText(), TEXT);
      // The file is written when a person asks for it, in the order of the schema.
      const written = await put("/file");
      assert.deepEqual([written.status, (written.body as ConfigurationView).file, fileText()], [200, "in_step", configurationText(CHANGED)]);
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
      assert.equal(problemCode(await post("/revisions", { basedOn: 2, document: CHANGED, replaceFile: true })), "400 invalid_request");
    });

    it("reads the file no more once it took it, and takes it again when asked, a file that differs becoming the revision in force", async () => {
      writeFileSync(join(repository, "oqas.json"), JSON.stringify(CHANGED, null, 4));
      const read = (await get("")).body as ConfigurationView;
      assert.deepEqual([read.revision?.number, read.file], [1, "changed"]);
      const kept = await post("/synchronisation");
      assert.equal(kept.status, 200);
      const taken = kept.body as ConfigurationView;
      assert.deepEqual([taken.revision?.number, taken.revision?.origin, taken.revision?.document, taken.file], [2, "file", CHANGED, "in_step"]);
    });

    it("refuses to take a file that is not valid, the revision in force kept", async () => {
      writeFileSync(join(repository, "oqas.json"), "{");
      const refused = await post("/synchronisation");
      assert.equal(problemCode(refused), "422 invalid_configuration");
      assert.deepEqual((refused.body as Problem).errors, [{ kind: "syntax", path: "", rule: "json", message: "The file is not valid JSON." }]);
      assert.equal(((await get("")).body as ConfigurationView).revision?.number, 1);
    });

    it("is kept by an API that was given no test repository, which has none of its own before one is saved, and takes no file", async () => {
      await api.close();
      await database.clear();
      api = await sessionsApi({ database: database.url });
      assert.deepEqual((await get("")).body, { file: "missing" } satisfies ConfigurationView);
      assert.equal(problemCode(await post("/synchronisation")), "404 no_configuration");
      assert.equal(problemCode(await put("/file")), "503 unavailable");
      const saved = await post("/revisions", { basedOn: 0, document: DOCUMENT });
      assert.deepEqual([saved.status, (saved.body as ConfigurationView).revision?.number, (saved.body as ConfigurationView).file], [201, 1, "missing"]);
      const repositoryRefused = await answerOf(await fetch(`${api.url}/repository`));
      assert.equal(problemCode(repositoryRefused), "503 unavailable");
    });
  });

  describe(`the test repository of an instance on ${engine.name}`, () => {
    const repositoryAt = async (path: string, method = "GET") => answerOf(await fetch(`${api.url}/repository${path}`, { method }));

    it("is made a git repository and a Playwright project from the configuration in force, which the state then tells", async () => {
      const before = await repositoryAt("");
      assert.deepEqual([before.status, before.cache, before.body], [200, "no-store", { folder: repository, git: "none", playwright: false }]);
      const prepared = await repositoryAt("/preparation", "POST");
      assert.equal(prepared.status, 200);
      const done = prepared.body as { created: string[]; committed: boolean };
      assert.deepEqual([done.committed, done.created.includes("playwright.config.ts")], [true, true]);
      assert.deepEqual((await repositoryAt("")).body, { folder: repository, git: "ready", playwright: true });
    });

    it("is refused its setup while there is no configuration", async () => {
      unlinkSync(join(repository, "oqas.json"));
      await api.close();
      await database.clear();
      api = await sessionsApi({ database: database.url, repository });
      assert.equal(problemCode(await repositoryAt("/preparation", "POST")), "404 no_configuration");
      assert.equal(problemCode(await put("/file")), "404 no_configuration");
    });
  });

  describe(`the values of the variables of an instance on ${engine.name}`, () => {
    const secrets = async (on = api) => answerOf(await fetch(`${on.url}/secrets`));
    const put = async (name: string, body: unknown, on = api) =>
      fetch(`${on.url}/secrets/${name}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    it("are listed without a value, saved out of the test repository, and never given back", async () => {
      const listed = await secrets();
      assert.deepEqual(
        [listed.status, listed.cache, listed.body],
        [200, "no-store", { secrets: [{ name: "SHOP_DB_URL", kind: "connection_string", paths: ["/knowledge/1/connectionStringEnv"], source: "missing" }] }],
      );
      const saved = await put("SHOP_DB_URL", { value: "postgres://shop" });
      assert.deepEqual([saved.status, await saved.text()], [204, ""]);
      assert.equal(((await secrets()).body as { secrets: { source: string }[] }).secrets[0]?.source, "saved");
      assert.deepEqual(JSON.parse(readFileSync(join(repository, ".oqas", "secrets", "values.json"), "utf8")), { SHOP_DB_URL: "postgres://shop" });
      assert.doesNotMatch(JSON.stringify((await secrets()).body), /postgres:\/\/shop/);
    });

    it("are refused for a variable the configuration does not name, empty, set by the environment, or not given as a text", async () => {
      const unknown = await answerOf(await put("NODE_OPTIONS", { value: "x" }));
      assert.equal(problemCode(unknown), "404 unknown_secret");
      assert.match((unknown.body as Problem).detail, /names no variable NODE_OPTIONS\. List the variables it names with GET \/secrets\./);
      assert.equal(problemCode(await answerOf(await put("SHOP_DB_URL", { value: "" }))), "409 secret_refused");
      assert.equal(problemCode(await answerOf(await put("SHOP_DB_URL", {}))), "400 invalid_request");
      await api.close();
      api = await sessionsApi({ database: database.url, repository, runs: { env: { SHOP_DB_URL: "from-env" } } });
      assert.equal(((await secrets()).body as { secrets: { source: string }[] }).secrets[0]?.source, "environment");
      assert.equal(problemCode(await answerOf(await put("SHOP_DB_URL", { value: "other" }))), "409 secret_refused");
    });

    it("are saved by no API that was given no test repository, which lists those of the revision in force", async () => {
      await api.close();
      api = await sessionsApi({ database: database.url });
      assert.equal(((await secrets()).body as { secrets: { name: string }[] }).secrets[0]?.name, "SHOP_DB_URL");
      assert.equal(problemCode(await answerOf(await put("SHOP_DB_URL", { value: "x" }))), "503 unavailable");
      await api.close();
      await database.clear();
      api = await sessionsApi({ database: database.url });
      assert.deepEqual((await secrets()).body, { secrets: [] });
    });
  });
}
