import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ApiClient } from "../../src/api/api-client.ts";
import type { ConfigurationAction } from "../../src/configuration/configuration-state.ts";
import { ConfigurationSync, READ_PAUSE_MS } from "../../src/configuration/configuration-sync.ts";
import { FakeDocument } from "../api/fake-document.ts";
import { DOCUMENT, REVISIONS, VIEW } from "./configuration-fixture.ts";

/** What the instance does when called. */
type Answer = () => Response;

const json =
  (body: unknown, status = 200): Answer =>
  () =>
    new Response(JSON.stringify(body), { status });

const ERROR = { kind: "structure", path: "/model/model", rule: "empty-value", message: "Expected a non-empty value." };

/** An instance a test plays, and the screen it tells. */
class PlayedApi {
  public readonly answers = new Map<string, Answer>();
  public readonly calls: string[] = [];
  public readonly bodies: unknown[] = [];
  public readonly told: ConfigurationAction[] = [];
  public readonly sync = new ConfigurationSync(
    new ApiClient(async (input, init) => {
      this.calls.push(`${init?.method ?? "GET"} ${input}`);
      if (init?.body !== undefined) this.bodies.push(JSON.parse(init.body as string));
      return this.answers.get(`${init?.method ?? "GET"} ${input}`)!();
    }),
    (action) => this.told.push(action),
  );
}

const settled = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

describe("what keeps the screen of the configuration in step with its instance", () => {
  let api = new PlayedApi();

  beforeEach(() => {
    api = new PlayedApi();
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", new FakeDocument());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads the configuration and its revisions again and again, and says when the instance cannot tell them", async () => {
    api.answers.set("GET /api/configuration", json(VIEW));
    api.answers.set("GET /api/configuration/revisions", json({ items: REVISIONS }));
    const stop = api.sync.read();
    await settled();
    assert.deepEqual(api.told, [{ type: "read", view: VIEW, revisions: REVISIONS }]);
    api.answers.set("GET /api/configuration", json({ code: "unavailable", detail: "Down." }, 503));
    await vi.advanceTimersByTimeAsync(READ_PAUSE_MS);
    assert.deepEqual(api.told.at(-1), { type: "unread", message: "Aucune source de sessions n’est configurée sur cette instance." });
    stop();
  });

  it("has a draft checked, and lets a check that fails go", async () => {
    api.answers.set("POST /api/configuration/validation", json({ errors: [ERROR] }));
    api.sync.check(DOCUMENT);
    await settled();
    assert.deepEqual(api.told, [{ type: "checked", draft: DOCUMENT, errors: [ERROR] }]);
    assert.deepEqual(api.bodies, [DOCUMENT]);
    api.answers.set("POST /api/configuration/validation", json({}, 500));
    api.sync.check(DOCUMENT);
    await settled();
    assert.equal(api.told.length, 1);
  });

  it("tests the connection to the model, and tells what the instance found, or why it could not", async () => {
    const model = DOCUMENT.model;
    api.answers.set("POST /api/configuration/model-connection", json({ state: "key-missing", variable: "MODEL_KEY" }));
    api.sync.testModel(model);
    await settled();
    assert.deepEqual(api.told, [
      { type: "testing", model },
      { type: "tested", model, check: { state: "key-missing", variable: "MODEL_KEY" } },
    ]);
    assert.deepEqual(api.bodies, [model]);
    api.answers.set("POST /api/configuration/model-connection", json({ code: "invalid_request", detail: "Bad." }, 400));
    api.sync.testModel(model);
    await settled();
    assert.equal(api.told.at(-1)!.type, "tested");
    assert.ok("failure" in api.told.at(-1)!);
  });

  it("saves a change made from a revision, says it saved, and lists the revisions again, or lets that list go when it fails", async () => {
    api.answers.set("POST /api/configuration/revisions", json(VIEW, 201));
    api.answers.set("GET /api/configuration/revisions", json({ items: REVISIONS }));
    api.sync.save(DOCUMENT, 1, false);
    await settled();
    assert.deepEqual(api.told, [{ type: "saving" }, { type: "saved", view: VIEW }, { type: "listed", revisions: REVISIONS }]);
    assert.deepEqual(api.bodies, [{ basedOn: 1, document: DOCUMENT }]);
    api.answers.set("GET /api/configuration/revisions", json({}, 500));
    api.sync.save(DOCUMENT, 2, true);
    await settled();
    assert.deepEqual(api.bodies.at(-1), { basedOn: 2, document: DOCUMENT, replaceFile: true });
    assert.deepEqual(api.told.slice(3), [{ type: "saving" }, { type: "saved", view: VIEW }]);
  });

  it("tells why the instance refused a change, with the errors it found, and takes the file when asked", async () => {
    api.answers.set("POST /api/configuration/revisions", json({ code: "invalid_configuration", detail: "Not valid.", errors: [ERROR] }, 422));
    api.sync.save(DOCUMENT, 2, false);
    await settled();
    assert.deepEqual(api.told.at(-1), {
      type: "refused",
      code: "invalid_configuration",
      text: "La configuration n’est pas valide : corrigez les champs signalés.",
      errors: [ERROR],
    });
    api.answers.set("POST /api/configuration/synchronisation", json(VIEW));
    api.answers.set("GET /api/configuration/revisions", json({ items: REVISIONS }));
    api.sync.keepFile();
    await settled();
    assert.deepEqual(api.told.slice(-3), [{ type: "saving" }, { type: "saved", view: VIEW }, { type: "listed", revisions: REVISIONS }]);
    assert.ok(api.calls.includes("POST /api/configuration/synchronisation"));
  });
  it("reads where the test repository stands, and tells nothing when the instance cannot say", async () => {
    api.answers.set("GET /api/repository", json({ git: "none", playwright: false }));
    api.sync.readRepository();
    await settled();
    assert.deepEqual(api.told, [{ type: "repository", repository: { git: "none", playwright: false } }]);
    api.answers.set("GET /api/repository", json({ code: "unavailable", detail: "Down." }, 503));
    api.sync.readRepository();
    await settled();
    assert.equal(api.told.length, 1);
  });

  it("saves the first configuration, then sets the test repository up, or tells why it could not", async () => {
    const preparation = { created: ["package.json"], kept: [], committed: true };
    api.answers.set("POST /api/configuration/revisions", json(VIEW, 201));
    api.answers.set("GET /api/configuration/revisions", json({ items: REVISIONS }));
    api.answers.set("POST /api/repository/preparation", json(preparation));
    api.sync.setUp(DOCUMENT);
    await settled();
    assert.deepEqual(api.bodies, [{ basedOn: 0, document: DOCUMENT }]);
    assert.deepEqual(api.told.slice(0, 2), [{ type: "saving" }, { type: "saved", view: VIEW }]);
    assert.deepEqual(
      api.told.find((action) => action.type === "prepared"),
      { type: "prepared", preparation },
    );
    api.answers.set("POST /api/repository/preparation", json({ code: "unavailable", detail: "Down." }, 503));
    const before = api.told.length;
    api.sync.setUp(DOCUMENT);
    await settled();
    assert.deepEqual(
      api.told.slice(before).find((action) => action.type === "refused"),
      { type: "refused", code: "unavailable", text: "Aucune source de sessions n’est configurée sur cette instance.", errors: [] },
    );
  });
});
