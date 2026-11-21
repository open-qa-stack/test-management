import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentEvent, TaskLimits } from "@open-qa-stack/domain";
import { afterEach, describe, it } from "vitest";
import { modelReach } from "../src/copilot/copilot-agent-runtime.ts";
import { CopilotAgentSession } from "../src/copilot/copilot-agent-session.ts";
import { EventRelay } from "../src/copilot/event-relay.ts";
import { checkGitHubAccount, copilotAccountClient, type CopilotAccountClient } from "../src/copilot/github-account.ts";
import { TaskBudget } from "../src/guardrails/task-budget.ts";
import { checkProviderModels } from "../src/model-connection/provider-models.ts";

/** Who is signed in, as the SDK tells it. */
type GetAuthStatusResponse = Awaited<ReturnType<CopilotAccountClient["getAuthStatus"]>>;
/** A model, as the SDK lists it. */
type ModelInfo = Awaited<ReturnType<CopilotAccountClient["listModels"]>>[number];
/** A session of the SDK, as a session of the runtime takes it. */
type CopilotSession = ConstructorParameters<typeof CopilotAgentSession>[0];
/** What a session of the SDK hands its listener. */
type SessionEvent = Parameters<Parameters<CopilotSession["on"]>[0]>[0];

/** A model of Copilot as the SDK lists it. */
function info(id: string, vision: boolean, extra: Partial<ModelInfo> = {}): ModelInfo {
  return { id, name: id.toUpperCase(), capabilities: { supports: { vision, reasoningEffort: false }, limits: {} }, ...extra } as ModelInfo;
}

/** A client of the SDK a test plays: who is signed in, and the models it offers. */
class PlayedClient implements CopilotAccountClient {
  public stopped = false;
  readonly #auth: GetAuthStatusResponse;
  readonly #models: ModelInfo[];
  public constructor(auth: GetAuthStatusResponse, models: ModelInfo[] = []) {
    this.#auth = auth;
    this.#models = models;
  }
  public start(): Promise<void> {
    return Promise.resolve();
  }
  public getAuthStatus(): Promise<GetAuthStatusResponse> {
    return Promise.resolve(this.#auth);
  }
  public listModels(): Promise<ModelInfo[]> {
    return Promise.resolve(this.#models);
  }
  public stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }
}

describe("the check of the GitHub account of the machine", () => {
  it("says who is signed in and the models Copilot offers them, without those it disables", async () => {
    const client = new PlayedClient({ isAuthenticated: true, login: "octo", authType: "gh-cli" }, [
      info("gpt-5", true, { supportedReasoningEfforts: ["low", "high"] }),
      info("old", false, { policy: { state: "disabled", terms: "" } }),
      info("mini", false),
    ]);
    assert.deepEqual(await checkGitHubAccount({}, () => client), {
      state: "connected",
      account: "octo",
      models: [
        { id: "gpt-5", name: "GPT-5", vision: true, reasoningEfforts: ["low", "high"] },
        { id: "mini", name: "MINI", vision: false, reasoningEfforts: [] },
      ],
    });
    assert.ok(client.stopped);
  });

  it("says when no account is signed in, and when Copilot offers the account none", async () => {
    assert.deepEqual(await checkGitHubAccount({}, () => new PlayedClient({ isAuthenticated: false })), { state: "signed-out" });
    assert.deepEqual(await checkGitHubAccount({}, () => new PlayedClient({ isAuthenticated: true })), { state: "signed-out" });
    assert.deepEqual(await checkGitHubAccount({}, () => new PlayedClient({ isAuthenticated: true, login: "octo" })), { state: "no-models", account: "octo" });
  });

  it("makes the client of the SDK itself, which starts nothing until it is started", () => {
    const client = copilotAccountClient({ PATH: "/usr/bin" })("/tmp/oqas-github-test");
    assert.equal(typeof client.getAuthStatus, "function");
    assert.equal(typeof client.listModels, "function");
  });
});

describe("the check of an OpenAI-compatible server", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((resolve) => (server === undefined ? resolve() : server.close(() => resolve()))));

  /** A server that answers its list of models as told, and keeps the authorisation it was sent. */
  async function serving(status: number, body: string): Promise<{ url: string; seen: (string | undefined)[] }> {
    const seen: (string | undefined)[] = [];
    server = createServer((request, response) => {
      seen.push(request.url === "/v1/models" ? request.headers.authorization : `wrong path ${request.url}`);
      response.writeHead(status, { "content-type": "application/json" }).end(body);
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    return { url: `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1/`, seen };
  }

  it("lists the models it names, sorted and once each, with the key it was given", async () => {
    const { url, seen } = await serving(200, JSON.stringify({ data: [{ id: "b" }, { id: "a" }, { id: "b" }, { name: "no id" }] }));
    assert.deepEqual(await checkProviderModels(url, "secret"), {
      state: "connected",
      models: [
        { id: "a", name: "a", reasoningEfforts: [] },
        { id: "b", name: "b", reasoningEfforts: [] },
      ],
    });
    assert.deepEqual(seen, ["Bearer secret"]);
  });

  it("is connected with no list when the server gives none, or no model, or fails to", async () => {
    for (const [status, body] of [
      [200, "{}"],
      [200, '{"data":[]}'],
      [200, "not json"],
      [404, "{}"],
    ] as const) {
      const { url, seen } = await serving(status, body);
      assert.deepEqual(await checkProviderModels(url, undefined), { state: "connected" }, body);
      assert.deepEqual(seen, [undefined]);
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("says when the key is refused, and when nothing answers", async () => {
    for (const status of [401, 403]) {
      const { url } = await serving(status, "{}");
      assert.deepEqual(await checkProviderModels(url, "bad"), { state: "key-refused", status });
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    assert.deepEqual(await checkProviderModels("http://127.0.0.1:9/v1", undefined), { state: "unreachable", url: "http://127.0.0.1:9/v1" });
  });
});

describe("how a session reaches its model", () => {
  it("goes through a channel of its gateway, or through the GitHub account with the effort asked for", () => {
    const channel = { baseUrl: "http://127.0.0.1:1/c/1/v1", lastFailure: undefined };
    const gates: unknown[] = [];
    const endpoint = { createChannel: (gate: unknown) => (gates.push(gate), channel) };
    const gate = { startIteration: () => undefined, stopped: false };
    assert.deepEqual(modelReach(endpoint, gate, "high"), {
      config: { provider: { type: "openai", wireApi: "completions", baseUrl: "http://127.0.0.1:1/c/1/v1" } },
      wiring: { channel },
    });
    assert.deepEqual(gates, [gate]);
    assert.deepEqual(modelReach(undefined, gate, "high"), { config: { reasoningEffort: "high" }, wiring: {} });
    assert.deepEqual(modelReach(undefined, undefined, undefined), { config: {}, wiring: {} });
  });
});

/** A session of the SDK a test drives by the events it emits. */
class PlayedSession {
  public handler: ((event: SessionEvent) => void) | undefined;
  public aborted = 0;
  public on(handler: (event: SessionEvent) => void): () => void {
    this.handler = handler;
    return () => undefined;
  }
  public send(): Promise<string> {
    return Promise.resolve("message");
  }
  public abort(): Promise<void> {
    this.aborted++;
    return Promise.resolve();
  }
  public disconnect(): Promise<void> {
    return Promise.resolve();
  }
  public emit(type: string, data: object = {}): void {
    this.handler!({ type, data } as unknown as SessionEvent);
  }
}

/** The events of a turn, once the session went idle. */
async function turnOf(session: CopilotAgentSession, played: PlayedSession, events: readonly [string, object?][]): Promise<AgentEvent[]> {
  const told: AgentEvent[] = [];
  const turn = (async () => {
    for await (const event of session.send("go")) told.push(event);
  })();
  await Promise.resolve();
  for (const [type, data] of events) played.emit(type, data);
  played.emit("session.idle");
  await turn;
  return told;
}

const clock = { now: () => 0 };
const limits = (maxIterations: number): TaskLimits => ({ maxIterations, maxDurationMs: null, maxActions: null });

describe("a session on a model of GitHub Copilot", () => {
  it("counts each call to the model and its tokens from the events of the SDK, and stops once a limit is reached", async () => {
    const played = new PlayedSession();
    const budget = new TaskBudget(limits(1), clock);
    const session = new CopilotAgentSession(
      played as unknown as CopilotSession,
      new EventRelay(),
      { toolNames: new Set(), budget, refused: new Map() },
      () => undefined,
    );
    const told = await turnOf(session, played, [
      ["assistant.turn_start"],
      ["assistant.usage", { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 }],
      ["assistant.usage", {}],
      ["assistant.turn_start"],
    ]);
    assert.equal(played.aborted, 1);
    assert.equal(told.at(-1)!.type, "stopped");
    assert.deepEqual(budget.counters, { iterations: 1, actions: 0, elapsedMs: 0, inputTokens: 10, outputTokens: 2, cachedTokens: 4 });
  });

  it("tells a failure as the SDK words it, and counts nothing for a task without limits", async () => {
    const played = new PlayedSession();
    const session = new CopilotAgentSession(
      played as unknown as CopilotSession,
      new EventRelay(),
      { toolNames: new Set(), budget: undefined, refused: new Map() },
      () => undefined,
    );
    const told = await turnOf(session, played, [
      ["assistant.turn_start"],
      ["assistant.usage", { inputTokens: 1, outputTokens: 1 }],
      ["session.error", { errorType: "quota", message: "Quota exceeded." }],
    ]);
    const last = told.at(-1)!;
    assert.equal(last.type, "error");
    assert.equal(last.type === "error" && last.error.message, "GitHub Copilot: Quota exceeded.");
  });

  it("leaves the counting to the gateway when it has a channel", async () => {
    const played = new PlayedSession();
    const budget = new TaskBudget(limits(5), clock);
    const channel = { baseUrl: "http://127.0.0.1:1/c/1/v1", lastFailure: undefined };
    const session = new CopilotAgentSession(
      played as unknown as CopilotSession,
      new EventRelay(),
      { channel, toolNames: new Set(), budget, refused: new Map() },
      () => undefined,
    );
    await turnOf(session, played, [["assistant.turn_start"], ["assistant.usage", { inputTokens: 3, outputTokens: 3 }]]);
    assert.deepEqual(budget.counters, { iterations: 0, actions: 0, elapsedMs: 0 });
  });
});
