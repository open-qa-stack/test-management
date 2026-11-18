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
