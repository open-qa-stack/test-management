import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalRequest, describeRequest, type CanonicalRequest } from "./canonical-request.ts";
import type { GatewayFailure } from "./gateway-failure.ts";
import type { GatewayMode } from "./gateway-mode.ts";
import type { ModelEndpoint } from "./model-endpoint.ts";
import type { Exchange, Recording } from "./recording.ts";
import type { Upstream } from "./upstream.ts";

const COMPLETIONS = "/v1/chat/completions";

/**
 * Local HTTP server the model runtime talks to instead of the model server.
 *
 * @remarks
 * Because the gateway makes the call, it knows exactly why one fails (`lastFailure`), and an API key
 * never leaves this process except towards the model server. Failures are answered with status 400,
 * which the runtime reports at once instead of retrying. A gateway serves one session at a time:
 * `lastFailure` describes the latest request, whoever sent it.
 */
export class ModelGateway implements ModelEndpoint {
  private readonly mode: GatewayMode;
  private readonly server: Server;
  private readonly recorded: Exchange[] = [];
  private readonly replayed = new Set<number>();
  private requests = 0;
  private failure: GatewayFailure | undefined;

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

  /** {@inheritDoc ModelEndpoint.baseUrl} */
  public get baseUrl(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1`;
  }

  /** {@inheritDoc ModelEndpoint.lastFailure} */
  public get lastFailure(): GatewayFailure | undefined {
    return this.failure;
  }

  /**
   * What `record` mode has captured so far.
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
    this.failure = undefined;
    let body: string;
    let request: CanonicalRequest;
    try {
      body = await readBody(req);
      if (req.method !== "POST" || req.url !== COMPLETIONS) {
        return this.fail(res, { kind: "unsupported", path: `${req.method} ${req.url}` });
      }
      request = canonicalRequest(JSON.parse(body));
    } catch {
      return this.fail(res, { kind: "invalid-request" });
    }
    const position = ++this.requests;
    if (this.mode.kind === "replay") return this.replay(res, this.mode.recording, request, position);
    return this.forward(res, this.mode.upstream, body, request);
  }

  private replay(res: ServerResponse, recording: Recording, request: CanonicalRequest, position: number): void {
    const key = JSON.stringify(request);
    const index = recording.exchanges.findIndex((e, i) => !this.replayed.has(i) && JSON.stringify(e.request) === key);
    if (index < 0) return this.fail(res, { kind: "replay-miss", request: describeRequest(request, position) });
    this.replayed.add(index);
    send(res, 200, recording.exchanges[index]!.response);
  }

  private async forward(res: ServerResponse, upstream: Upstream, body: string, request: CanonicalRequest): Promise<void> {
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
      return this.fail(res, { kind: "unreachable", url: upstream.baseUrl });
    }
    if (!answer.ok) return this.fail(res, { kind: "upstream-status", status: answer.status });
    let response: unknown;
    try {
      response = JSON.parse(text);
    } catch {
      return this.fail(res, { kind: "invalid-response" });
    }
    if (this.mode.kind === "record") this.recorded.push({ request, response });
    send(res, 200, response);
  }

  private fail(res: ServerResponse, failure: GatewayFailure): void {
    this.failure = failure;
    send(res, 400, { error: { message: `Model gateway: ${failure.kind}.`, type: "gateway_error" } });
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

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
