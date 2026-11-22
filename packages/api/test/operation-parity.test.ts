import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { operationIds, type OperationId } from "@open-qa-stack/domain";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { sessionsApi, type TestApi } from "./support/sessions-api.ts";

/** How the API offers an operation: the route that calls it, or why it offers none. */
type Offer = `${"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} /${string}` | { readonly none: string };

/**
 * How the API — and the console through it — offers each operation of the engine. Typed on the operations, it does not
 * compile while an operation of the engine has no route here, nor a reason for none.
 */
const ROUTES: Readonly<Record<OperationId, Offer>> = {
  "Sessions.project": "GET /project",
  "Sessions.sessions": "GET /sessions",
  "Sessions.session": "GET /sessions/s",
  "Sessions.open": "POST /sessions",
  "Sessions.resume": "POST /sessions/s/resumption",
  "Sessions.say": "POST /sessions/s/messages",
  "Sessions.interrupt": "POST /sessions/s/interruption",
  "Sessions.events": "GET /sessions/s/events",
  // The stream of the events starts with the thread so far.
  "Sessions.thread": "GET /sessions/s/events",
  "Sessions.launch": "POST /launches",
  "Sessions.launches": "GET /launches",
  "Configuration.view": "GET /configuration",
  "Configuration.revisions": "GET /configuration/revisions",
  "Configuration.check": "POST /configuration/validation",
  "Configuration.synchronise": "POST /configuration/synchronisation",
  "Configuration.save": "POST /configuration/revisions",
  "Configuration.restore": "PUT /configuration/file",
  "ModelConnection.check": "POST /configuration/model-connection",
  "Secrets.list": "GET /secrets",
  "Secrets.save": "PUT /secrets/S",
  "RepositorySetup.state": "GET /repository",
  "RepositorySetup.prepare": "POST /repository/preparation",
  "KnowledgeDocuments.list": "GET /knowledge/s/documents",
  "KnowledgeDocuments.read": "GET /knowledge/s/documents/d.md",
  "KnowledgeDocuments.upload": "POST /knowledge/s/documents",
  "KnowledgeDocuments.remove": "DELETE /knowledge/s/documents/d.md",
  "KnowledgeDomains.list": "GET /knowledge/domains",
  "KnowledgeSources.check": "POST /knowledge/check",
  "KnowledgeMapping.state": "GET /knowledge/mapping",
  "RepositoryTests.listed": "GET /tests",
  "TestReadings.read": "GET /tests/reading",
  "TestReadings.trace": "GET /tests/trace",
  "TestReadings.capture": "GET /tests/capture",
  "TestSources.read": "GET /tests/source",
  "TestSources.change": "PATCH /tests",
  "Executions.page": "GET /executions",
  "Executions.get": "GET /executions/e",
  "Executions.ofFile": "GET /tests/executions",
  "Executions.versions": "GET /tests/versions",
  "Campaigns.plan": "POST /campaigns",
  "Campaigns.list": "GET /campaigns",
  "Campaigns.progress": "GET /campaigns/c",
  "Campaigns.choose": "PUT /campaigns/c/tests",
  "Campaigns.ready": "POST /campaigns/c/readiness",
  "Campaigns.launch": "POST /campaigns/c/launches",
  "Campaigns.close": "POST /campaigns/c/closure",
};

describe("the operations of the engine, as the API offers them", () => {
  const repository = mkdtempSync(join(tmpdir(), "oqas-api-parity-"));
  let api: TestApi;
  before(async () => {
    writeFileSync(join(repository, "oqas.json"), fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/"));
    api = await sessionsApi({ database: `sqlite:${join(repository, "instance.db")}`, repository });
  });
  after(async () => {
    await api.close();
    rmSync(repository, { recursive: true, force: true });
  });

  /** Whether the API routes a request: anything but the answer of the framework to a route it does not know. */
  async function routes(route: string): Promise<boolean> {
    const [method, path] = route.split(" ") as [string, string];
    const response = await fetch(`${api.url}${path}`, {
      method,
      ...(method === "GET" || method === "DELETE" ? {} : { headers: { "content-type": "application/json" }, body: "{}" }),
      signal: AbortSignal.timeout(5000),
    });
    const body = await (path.endsWith("/events") ? Promise.resolve("") : response.text());
    return !(response.status === 404 && body.includes(`Cannot ${method} /api${path}`));
  }

  it("each have a route the API serves, or a reason for none", async () => {
    for (const id of operationIds()) {
      const offer = ROUTES[id];
      if (typeof offer === "string") assert.ok(await routes(offer), `${id}: ${offer} is no route of the API`);
      else assert.ok(offer.none.length > 0, id);
    }
  });

  it("are told from a route the API does not serve", async () => {
    assert.equal(await routes("GET /nowhere"), false);
  });
});
