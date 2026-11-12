import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalRequest, describeRequest, type CanonicalRequest } from "./canonical-request.ts";
import { GatewayChannel } from "./gateway-channel.ts";
import type { GatewayFailure } from "./gateway-failure.ts";
import type { GatewayMode } from "./gateway-mode.ts";
import type { ModelChannel } from "./model-channel.ts";
import type { ModelEndpoint } from "./model-endpoint.ts";
import type { Exchange, Recording } from "./recording.ts";
import type { RequestGate } from "./request-gate.ts";
import type { Upstream } from "./upstream.ts";

/** `/c/<channel>/v1/<operation>`: every request names the channel of its session. */
const CHANNEL_PATH = /^\/c\/(\d+)\/v1(\/.*)$/;
const COMPLETIONS = "/chat/completions";

/**
 * Local HTTP server the model runtime talks to instead of the model server.
 *
 * @remarks
 * Because the gateway makes the call, it knows exactly why one fails, and an API key never leaves this
 * process except towards the model server. Each session talks to its own channel, which keeps its own
 * gate and its own latest failure, so that sessions never see each other's limits or errors. Failures
 * are answered with status 400, which the runtime reports at once instead of retrying.
 */
export class ModelGateway implements ModelEndpoint {
  private readonly mode: GatewayMode;
  private readonly server: Server;
  private readonly channels = new Map<string, GatewayChannel>();
  private readonly recorded: Exchange[] = [];
  private readonly replayed = new Set<number>();

  private constructor(mode: GatewayMode, server: Server) {
    this.mode = mode;
    this.server = server;
  }

  /**
   * Starts a gateway on a free loopback port.
   *
   * @param mode - How the gateway answers.
   * @returns The running gateway.
   */
  public static async start(mode: GatewayMode): Promise<ModelGateway> {
    const server = createServer();
    const gateway = new ModelGateway(mode, server);
    server.on("request", (req, res) => void gateway.handle(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return gateway;
  }

  /** {@inheritDoc ModelEndpoint.createChannel} */
  public createChannel(gate: RequestGate | undefined): ModelChannel {
    const key = String(this.channels.size + 1);
    const { port } = this.server.address() as AddressInfo;
    const channel = new GatewayChannel(`http://127.0.0.1:${port}/c/${key}/v1`, gate);
    this.channels.set(key, channel);
    return channel;
  }

  /**
   * What `record` mode has captured so far, every channel included.
   *
   * @throws Error when the gateway is not in record mode.
   */
  public get recording(): Recording {
    if (this.mode.kind !== "record") throw new Error("Only a gateway in record mode produces a recording.");
    return { formatVersion: 1, origin: this.mode.origin, exchanges: [...this.recorded] };
  }

  /** Stops the server. */
  public async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const route = CHANNEL_PATH.exec(String(req.url));
    const channel = route === null ? undefined : this.channels.get(route[1]!);
    if (route === null || channel === undefined) {
      return send(res, 404, { error: { message: "Model gateway: unknown channel.", type: "gateway_error" } });
    }
    const operation = route[2]!;
    channel.receive();
    let body: string;
    let request: CanonicalRequest;
    try {
      body = await readBody(req);
      if (req.method !== "POST" || operation !== COMPLETIONS) {
        return fail(res, channel, { kind: "unsupported", path: `${req.method} ${operation}` });
      }
      request = canonicalRequest(JSON.parse(body));
    } catch {
      return fail(res, channel, { kind: "invalid-request" });
    }
    channel.gate?.startIteration();
    if (channel.gate?.stopped === true) return fail(res, channel, { kind: "task-stopped" });
    if (this.mode.kind === "replay") return this.replay(res, channel, this.mode.recording, request);
    return this.forward(res, channel, this.mode.upstream, body, request);
  }

  private replay(res: ServerResponse, channel: GatewayChannel, recording: Recording, request: CanonicalRequest): void {
    const { exchanges } = recording;
    const key = JSON.stringify(request);
    const index = exchanges.findIndex((e, i) => !this.replayed.has(i) && JSON.stringify(e.request) === key);
    if (index < 0) return fail(res, channel, { kind: "replay-miss", request: describeRequest(request, channel.requestCount) });
    this.replayed.add(index);
    send(res, 200, exchanges[index]!.response);
  }

  private async forward(res: ServerResponse, channel: GatewayChannel, upstream: Upstream, body: string, request: CanonicalRequest): Promise<void> {
    let answer: Response;
    let text: string;
    try {
      answer = await fetch(`${upstream.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...bearer(upstream.apiKey) },
        body,
      });
      text = await answer.text();
    } catch {
      return fail(res, channel, { kind: "unreachable", url: upstream.baseUrl });
    }
    if (!answer.ok) return fail(res, channel, { kind: "upstream-status", status: answer.status });
    let response: unknown;
    try {
      response = JSON.parse(text);
    } catch {
      return fail(res, channel, { kind: "invalid-response" });
    }
    if (this.mode.kind === "record") this.recorded.push({ request, response });
    send(res, 200, response);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function bearer(apiKey: string | undefined): Record<string, string> {
  return apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` };
}

function fail(res: ServerResponse, channel: GatewayChannel, failure: GatewayFailure): void {
  channel.fail(failure);
  send(res, 400, { error: { message: `Model gateway: ${failure.kind}.`, type: "gateway_error" } });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
