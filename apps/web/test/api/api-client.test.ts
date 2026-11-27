import assert from "node:assert/strict";
import type { OqasConfig, Project } from "@open-qa-stack/domain/sessions";
import { describe, it } from "vitest";
import { API_BASE, ApiClient, type Fetch } from "../../src/api/api-client.ts";
import { ApiError } from "../../src/api/api-error.ts";
import { COMPLETED, RUNNING } from "../agent/session-fixture.ts";

const PROJECT: Project = { name: "Demo", applications: [{ id: "customer-management", name: "Customer Management" }] };

/** A call a client made to the network. */
type Call = readonly [input: string, init: RequestInit | undefined];

/**
 * A client whose network is a double.
 *
 * @param answer - What the network does at each call: an answer, or a failure it throws.
 * @returns The client, and the calls it made.
 */
function clientOf(answer: () => Response): { readonly client: ApiClient; readonly calls: Call[] } {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    calls.push([input, init]);
    return answer();
  };
  return { client: new ApiClient(fetch), calls };
}

/**
 * An answer of the API that carries a JSON body.
 *
 * @param body - The body.
 * @param status - Its status; a success by default.
 * @returns The answer.
 */
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * A problem, as the API answers one.
 *
 * @param code - Its code.
 * @param status - Its status.
 * @param detail - What it says went wrong.
 * @returns The answer.
 */
const problem = (code: string, status: number, detail = "The API says what went wrong."): Response =>
  new Response(JSON.stringify({ type: `/problems/${code}`, title: "A problem", status, detail, code }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });

/**
 * The error a call to the API fails with.
 *
 * @param call - The call.
 * @returns Its message, its status and its code, once checked to be an error of the API.
 */
async function failureOf(call: Promise<unknown>): Promise<{ readonly message: string; readonly status: number; readonly code: string }> {
  const error: unknown = await call.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  assert.ok(error instanceof ApiError);
  assert.equal(error.name, "ApiError");
  return { message: error.message, status: error.status, code: error.code };
}

describe("the client of the API, for the configuration", () => {
  const VIEW = { file: "missing" };
  const DOCUMENT = { formatVersion: 1 } as unknown as OqasConfig;
  const ERROR = { kind: "structure", path: "/applications", rule: "required", message: 'Missing required key "applications".' };

  it("reads the configuration as it is now, and its revisions out of the envelope the API answers", async () => {
    const read = clientOf(() => json(VIEW));
    assert.deepEqual(await read.client.configuration(), VIEW);
    const listed = clientOf(() => json({ items: [] }));
    assert.deepEqual(await listed.client.revisions(), []);
    assert.deepEqual(
      [...read.calls, ...listed.calls],
      [
        ["/api/configuration", undefined],
        ["/api/configuration/revisions", undefined],
      ],
    );
  });

  it("checks a configuration, saves a change and takes the file by posting to the routes of the configuration", async () => {
    const checked = clientOf(() => json({ errors: [ERROR] }));
    assert.deepEqual(await checked.client.check(DOCUMENT), [ERROR]);
    const saved = clientOf(() => json(VIEW, 201));
    assert.deepEqual(await saved.client.save({ basedOn: 1, document: DOCUMENT }), VIEW);
    const taken = clientOf(() => json(VIEW));
    assert.deepEqual(await taken.client.synchronise(), VIEW);
    assert.deepEqual(
      [...checked.calls, ...saved.calls, ...taken.calls],
      [
        ["/api/configuration/validation", { method: "POST", headers: { "content-type": "application/json" }, body: '{"formatVersion":1}' }],
        [
          "/api/configuration/revisions",
          { method: "POST", headers: { "content-type": "application/json" }, body: '{"basedOn":1,"document":{"formatVersion":1}}' },
        ],
        ["/api/configuration/synchronisation", { method: "POST" }],
      ],
    );
  });

  it("fails with the errors a configuration that is not valid holds, and with none for any other problem", async () => {
    const invalid = clientOf(
      () => new Response(JSON.stringify({ code: "invalid_configuration", status: 422, detail: "Not valid.", errors: [ERROR] }), { status: 422 }),
    );
    const error = await invalid.client.save({ basedOn: 1, document: DOCUMENT }).catch((reason: unknown) => reason);
    assert.ok(error instanceof ApiError);
    assert.deepEqual([error.code, error.errors], ["invalid_configuration", [ERROR]]);
    const stale = await clientOf(() => problem("stale_revision", 409))
      .client.save({ basedOn: 1, document: DOCUMENT })
      .catch((reason: unknown) => reason);
    assert.ok(stale instanceof ApiError);
    assert.deepEqual([stale.code, stale.errors], ["stale_revision", []]);
  });
});

describe("the client of the API, for the documents of the knowledge sources", () => {
  const SUMMARY = { name: "quotes é.md", bytes: 9, uploadedAt: "2026-11-18T09:00:00.000Z" };

  it("reads the defects, reports one and moves one by its reference", async () => {
    const list = { items: [], counts: { open: 0, toReplay: 0, closed: 0 } };
    const listed = clientOf(() => json(list));
    assert.deepEqual(await listed.client.defects(), list);
    assert.deepEqual(listed.calls, [["/api/defects", undefined]]);
    const report = { title: "Total", severity: "S2", description: "", test: { path: "a.spec.ts", title: "A" } } as const;
    const reported = clientOf(() => json({ id: "D-1" }));
    assert.deepEqual(await reported.client.reportDefect(report), { id: "D-1" });
    assert.deepEqual(
      reported.calls.map(([path, init]) => [path, init?.method, init?.body]),
      [["/api/defects", "POST", JSON.stringify(report)]],
    );
    const moved = clientOf(() => json({ id: "D 1" }));
    assert.deepEqual(await moved.client.changeDefect("D 1", "fixed"), { id: "D 1" });
    assert.deepEqual(
      moved.calls.map(([path, init]) => [path, init?.method, init?.body]),
      [["/api/defects/D%201", "PATCH", '{"status":"fixed"}']],
    );
  });

  it("reads the queue of the review, and a test of it by its identifier", async () => {
    const queue = { tests: [], counts: { inReview: 0, setAside: 0 } };
    const listed = clientOf(() => json(queue));
    assert.deepEqual(await listed.client.reviews(), queue);
    assert.deepEqual(listed.calls, [["/api/reviews", undefined]]);
    const read = clientOf(() => json({ id: "a b" }));
    assert.deepEqual(await read.client.proposal("a b"), { id: "a b" });
    assert.deepEqual(read.calls, [["/api/reviews/a%20b", undefined]]);
    const decided = { decision: { id: "a", status: "validated", at: "2026-11-27T10:00:00.000Z" }, entered: { branch: "main", committed: true } };
    const decide = clientOf(() => json(decided));
    assert.deepEqual(await decide.client.decide("a b", { status: "validated" }), decided);
    assert.deepEqual(
      decide.calls.map(([path, init]) => [path, init?.method, init?.body]),
      [["/api/reviews/a%20b/decision", "PUT", '{"status":"validated"}']],
    );
    const restored = clientOf(() => new Response(null, { status: 204 }));
    await restored.client.restore("a b");
    assert.deepEqual(restored.calls, [["/api/reviews/a%20b/decision", { method: "DELETE" }]]);
  });

  it("lists the tests of the test repository out of the envelope the API answers", async () => {
    const test = { path: "apps/shop/orders.spec.ts", title: "Orders", steps: [], tags: [], applications: [] };
    const listed = clientOf(() => json({ items: [test] }));
    assert.deepEqual(await listed.client.tests(), [test]);
    assert.deepEqual(listed.calls, [["/api/tests", undefined]]);
    const read = clientOf(() => json({ path: "apps/shop/orders.spec.ts" }));
    assert.deepEqual(await read.client.testReading("apps/shop/orders.spec.ts", "e 1"), { path: "apps/shop/orders.spec.ts" });
    assert.deepEqual(read.calls, [["/api/tests/reading?path=apps%2Fshop%2Forders.spec.ts&execution=e+1", undefined]]);
    const verdict = { path: "a.spec.ts", title: "Orders", verdict: "failed" };
    const last = clientOf(() => json({ items: [verdict] }));
    assert.deepEqual(await last.client.testVerdicts(), [verdict]);
    assert.deepEqual(last.calls, [["/api/tests/verdicts", undefined]]);
    const version = { path: "apps/shop/orders.spec.ts", title: "Orders", number: 1, digest: "d1", since: "2026-11-19T10:00:05.000Z", executions: 1 };
    const versioned = clientOf(() => json({ items: [version] }));
    assert.deepEqual(await versioned.client.testVersions("apps/shop/orders.spec.ts"), [version]);
    assert.deepEqual(versioned.calls, [["/api/tests/versions?path=apps%2Fshop%2Forders.spec.ts", undefined]]);
    const prompt = { agent: "writer", template: "Write.", variables: [], digest: "d" };
    const prompts = clientOf(() => json({ items: [prompt] }));
    assert.deepEqual(await prompts.client.agentPrompts(), [prompt]);
    assert.deepEqual(prompts.calls, [["/api/configuration/agents", undefined]]);
  });

  it("reads the code of a file of tests out of the envelope the API answers, and changes a test by patching the tests", async () => {
    const source = clientOf(() => json({ path: "apps/shop/orders.spec.ts", content: 'test("Orders", async () => {});\n' }));
    assert.equal(await source.client.testSource("apps/shop/orders.spec.ts"), 'test("Orders", async () => {});\n');
    assert.deepEqual(source.calls, [["/api/tests/source?path=apps%2Fshop%2Forders.spec.ts", undefined]]);
    const test = { path: "apps/shop/orders.spec.ts", title: "Orders", id: "3f0c2b9e-8d4a-4f1e-9b7a-2c5d6e7f8a90", steps: [], tags: [], applications: [] };
    const changed = clientOf(() => json(test));
    const change = { path: test.path, title: "List the orders", change: { title: "Orders" } };
    assert.deepEqual(await changed.client.changeTest(change), test);
    assert.deepEqual(
      changed.calls.map(([path, init]) => [path, init?.method, init?.body]),
      [["/api/tests", "PATCH", JSON.stringify(change)]],
    );
  });

  it("reads the domains of the knowledge out of the envelope the API answers", async () => {
    const domain = { id: "quotes", label: "Devis", description: "Les demandes de devis." };
    const listed = clientOf(() => json({ items: [domain] }));
    assert.deepEqual(await listed.client.domains(), [domain]);
    assert.deepEqual(listed.calls, [["/api/knowledge/domains", undefined]]);
    const changed = clientOf(() => json({ id: "a b", label: "Ventes" }));
    await changed.client.changeDomain("a b", { label: "Ventes" });
    assert.equal(changed.calls[0]![0], "/api/knowledge/domains/a%20b");
    assert.deepEqual([changed.calls[0]![1]?.method, changed.calls[0]![1]?.body], ["PATCH", '{"label":"Ventes"}']);
  });

  it("reads the campaigns and the launches, plans a campaign and changes it by posting to its routes, its identifier encoded", async () => {
    const campaign = {
      id: "c 1",
      name: "Recette",
      environment: "local",
      status: "planned",
      createdAt: "2026-11-20T08:00:00.000Z",
      tests: [],
    };
    const answered = clientOf(() => json(campaign));
    const { client, calls } = answered;
    assert.deepEqual(await client.campaigns(), campaign);
    assert.deepEqual(await client.planCampaign({ name: "Recette", environment: "local" }), campaign);
    await client.campaign("c 1");
    await client.chooseCampaignTests("c 1", [{ path: "apps/a.spec.ts", title: "A" }]);
    await client.readyCampaign("c 1");
    await client.launchCampaign("c 1");
    await client.launchCampaign("c 1", "failed");
    await client.closeCampaign("c 1");
    await client.launches();
    await client.launch({ paths: ["apps/shop/orders.spec.ts"], environment: "local" });
    assert.deepEqual(
      calls.map(([path, init]) => [path, init?.method ?? "GET", init?.body]),
      [
        ["/api/campaigns", "GET", undefined],
        ["/api/campaigns", "POST", JSON.stringify({ name: "Recette", environment: "local" })],
        ["/api/campaigns/c%201", "GET", undefined],
        ["/api/campaigns/c%201/tests", "PUT", JSON.stringify({ tests: [{ path: "apps/a.spec.ts", title: "A" }] })],
        ["/api/campaigns/c%201/readiness", "POST", undefined],
        ["/api/campaigns/c%201/launches", "POST", "{}"],
        ["/api/campaigns/c%201/launches", "POST", JSON.stringify({ only: "failed" })],
        ["/api/campaigns/c%201/closure", "POST", undefined],
        ["/api/launches", "GET", undefined],
        ["/api/launches", "POST", JSON.stringify({ paths: ["apps/shop/orders.spec.ts"], environment: "local" })],
      ],
    );
  });

  it("reads the executions of the tests a page at a time, one by its identifier, and those of a file out of the envelope the API answers", async () => {
    const execution = { id: "e 1", origin: "design", ranAt: "2026-11-19T10:00:05.000Z", report: "r.json", results: [] };
    const page = { items: [execution], total: 2, start: 0, next: "e 1" };
    const paged = clientOf(() => json(page));
    assert.deepEqual(await paged.client.executionPage(), page);
    await paged.client.executionPage({ outcome: "failing", since: "2026-11-19T00:00:00.000Z", before: "e 1" });
    const one = clientOf(() => json(execution));
    assert.deepEqual(await one.client.execution("e 1"), execution);
    const ofFile = clientOf(() => json({ items: [{ ...execution, result: {} }] }));
    assert.deepEqual(await ofFile.client.testExecutions("apps/shop/orders.spec.ts"), [{ ...execution, result: {} }]);
    assert.deepEqual(
      [...paged.calls, ...one.calls, ...ofFile.calls],
      [
        ["/api/executions", undefined],
        ["/api/executions?outcome=failing&since=2026-11-19T00%3A00%3A00.000Z&before=e+1", undefined],
        ["/api/executions/e%201", undefined],
        ["/api/tests/executions?path=apps%2Fshop%2Forders.spec.ts", undefined],
      ],
    );
  });

  it("lists the documents of a source out of the envelope the API answers, and reads one, each name encoded", async () => {
    const listed = clientOf(() => json({ items: [SUMMARY] }));
    assert.deepEqual(await listed.client.documents("user guides"), [SUMMARY]);
    const read = clientOf(() => json({ ...SUMMARY, text: "# Quotes\n" }));
    assert.deepEqual(await read.client.document("manuals", "quotes é.md"), { ...SUMMARY, text: "# Quotes\n" });
    assert.deepEqual(
      [...listed.calls, ...read.calls],
      [
        ["/api/knowledge/user%20guides/documents", undefined],
        ["/api/knowledge/manuals/documents/quotes%20%C3%A9.md", undefined],
      ],
    );
  });

  it("uploads files as the parts of a form, each under its name, and removes a document without reading the answer", async () => {
    const uploaded = clientOf(() => json({ items: [SUMMARY] }, 201));
    const files = [new File(["# Quotes\n"], "quotes é.md"), new File(["# Claims\n"], "claims.md")];
    assert.deepEqual(await uploaded.client.upload("manuals", files), [SUMMARY]);
    const [[path, init]] = uploaded.calls as [Call];
    assert.equal(path, "/api/knowledge/manuals/documents");
    assert.equal(init?.method, "POST");
    const body = init?.body as FormData;
    assert.deepEqual(
      body.getAll("documents").map((part) => (part as File).name),
      ["quotes é.md", "claims.md"],
    );
    const removed = clientOf(() => new Response(null, { status: 204 }));
    assert.equal(await removed.client.removeDocument("manuals", "quotes é.md"), undefined);
    assert.deepEqual(removed.calls, [["/api/knowledge/manuals/documents/quotes%20%C3%A9.md", { method: "DELETE" }]]);
  });
});

describe("the client of the API", () => {
  it("reaches the API under the path of the instance", () => {
    assert.equal(API_BASE, "/api");
  });

  it("reads the project of the instance", async () => {
    const { client, calls } = clientOf(() => json(PROJECT));
    assert.deepEqual(await client.project(), PROJECT);
    assert.deepEqual(calls, [["/api/project", undefined]]);
  });

  it("lists the sessions of the project, out of the envelope the API answers", async () => {
    const { client, calls } = clientOf(() => json({ items: [RUNNING, COMPLETED] }));
    assert.deepEqual(await client.sessions(), [RUNNING, COMPLETED]);
    assert.deepEqual(calls, [["/api/sessions", undefined]]);
  });

  it("reads one session by its identifier, encoded", async () => {
    const { client, calls } = clientOf(() => json(COMPLETED));
    assert.deepEqual(await client.session(COMPLETED.id), COMPLETED);
    await client.session("a/b c?d");
    assert.deepEqual(calls, [
      [`/api/sessions/${COMPLETED.id}`, undefined],
      ["/api/sessions/a%2Fb%20c%3Fd", undefined],
    ]);
  });

  it("opens a session by posting what to test as JSON, and gives the session the API opened", async () => {
    const { client, calls } = clientOf(() => json(RUNNING, 201));
    assert.deepEqual(await client.open({ request: "tester la recherche d'un client", environment: "local" }), RUNNING);
    assert.deepEqual(calls, [
      [
        "/api/sessions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"request":"tester la recherche d\'un client","environment":"local"}',
        },
      ],
    ]);
  });

  it("sends a message to a session by posting it as JSON under the identifier of the session, encoded, and gives its receipt", async () => {
    const { client, calls } = clientOf(() => json({ number: 2 }, 202));
    assert.deepEqual(await client.say("a/b", { text: "sans le profil" }), { number: 2 });
    assert.deepEqual(calls, [
      ["/api/sessions/a%2Fb/messages", { method: "POST", headers: { "content-type": "application/json" }, body: '{"text":"sans le profil"}' }],
    ]);
  });

  it("resumes a session that ended by posting what the person says as JSON under the identifier of the session, encoded, and gives the session", async () => {
    const { client, calls } = clientOf(() => json(RUNNING, 202));
    assert.deepEqual(await client.resume("a/b", { text: "corriger le test en échec" }), RUNNING);
    assert.deepEqual(calls, [
      ["/api/sessions/a%2Fb/resumption", { method: "POST", headers: { "content-type": "application/json" }, body: '{"text":"corriger le test en échec"}' }],
    ]);
  });

  it("asks to interrupt a session by a post without a body under its identifier, encoded, and reads nothing of the answer", async () => {
    const { client, calls } = clientOf(() => new Response(null, { status: 202 }));
    assert.equal(await client.interrupt("a/b"), undefined);
    assert.deepEqual(calls, [["/api/sessions/a%2Fb/interruption", { method: "POST" }]]);
    const ended = clientOf(() => problem("session_ended", 409));
    assert.deepEqual(await failureOf(ended.client.interrupt("oqas-1")), {
      message: "La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.",
      status: 409,
      code: "session_ended",
    });
    const down = clientOf(() => {
      throw new TypeError("Failed to fetch");
    });
    assert.deepEqual(await failureOf(down.client.interrupt("oqas-1")), { message: "L’instance ne répond pas.", status: 0, code: "unreachable" });
  });

  it("says a session that just ended takes no more message", async () => {
    const { client } = clientOf(() => problem("session_ended", 409));
    await assert.rejects(client.say("oqas-1", { text: "sans le profil" }), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.deepEqual(
        [error.message, error.status, error.code],
        ["La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.", 409, "session_ended"],
      );
      return true;
    });
  });
});

describe("a failure of the API", () => {
  it("carries the status and the code of the problem, worded by the console for the person", async () => {
    const { client } = clientOf(() => problem("session_running", 409));
    assert.deepEqual(await failureOf(client.open({ request: "tester" })), {
      message: "La session est de nouveau en cours : envoyez-lui votre message comme à une session qui travaille.",
      status: 409,
      code: "session_running",
    });
    const unknown = clientOf(() => problem("unknown_session", 404));
    assert.deepEqual(await failureOf(unknown.client.session("gone")), {
      message: "Le projet ne garde aucune session de ce nom.",
      status: 404,
      code: "unknown_session",
    });
  });

  it("says what the API says of a problem the console has no wording for", async () => {
    const { client } = clientOf(() => problem("error", 500, "The folder of the sessions cannot be read."));
    assert.deepEqual(await failureOf(client.sessions()), { message: "The folder of the sessions cannot be read.", status: 500, code: "error" });
  });

  it("reads a code it does not know as an error, and keeps what the API says of it", async () => {
    const { client } = clientOf(() => problem("quota_exceeded", 429, "Too many sessions were opened today."));
    assert.deepEqual(await failureOf(client.open({ request: "tester" })), { message: "Too many sessions were opened today.", status: 429, code: "error" });
  });

  it("says no more than that the instance failed when the answer is no problem", async () => {
    for (const answer of [
      () => new Response("<html>Bad Gateway</html>", { status: 502 }),
      () => json({ message: "lost" }, 500),
      () => json({ code: 42, detail: 42 }, 500),
      () => json({ code: "error", detail: "" }, 500),
      () => json(null, 500),
    ]) {
      const { client } = clientOf(answer);
      const { message, code } = await failureOf(client.project());
      assert.deepEqual([message, code], ["L’instance a rencontré une erreur.", "error"]);
    }
  });

  it("carries the status of a success whose body is not JSON", async () => {
    const { client } = clientOf(() => new Response("<html>OK</html>", { status: 200 }));
    assert.deepEqual(await failureOf(client.project()), { message: "La réponse de l’instance est illisible.", status: 200, code: "error" });
  });

  it("has a code of its own, and the status 0, when the instance cannot be reached", async () => {
    const { client, calls } = clientOf(() => {
      throw new TypeError("Failed to fetch");
    });
    assert.deepEqual(await failureOf(client.sessions()), { message: "L’instance ne répond pas.", status: 0, code: "unreachable" });
    assert.equal(calls.length, 1);
  });
});
