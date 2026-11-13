import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** How long `/api/slow` takes to answer, in milliseconds. */
export const SLOW_MS = 1200;

/** A site served on the loopback interface, which remembers what it was asked for. */
export interface TestSite {
  /** Its origin, `http://127.0.0.1:<port>`. */
  readonly origin: string;
  /** Requests received so far, as `<method> <path>`. */
  readonly requested: string[];
  /** Stops the site, dropping the connections the browser keeps open. */
  close(): Promise<void>;
}

/** A redirect the site answers for a path. */
export interface Redirect {
  readonly status: number;
  readonly location: string;
}

/**
 * Serves pages on the loopback interface.
 *
 * @param pages - HTML of each path, query excluded; `/api/ping` answers JSON, to any origin, `/api/slow` answers JSON after `SLOW_MS`, any other path 404.
 * @param redirects - Paths answered with a redirect.
 * @returns The running site.
 */
export async function testSite(pages: Readonly<Record<string, string>>, redirects: Readonly<Record<string, Redirect>> = {}): Promise<TestSite> {
  const requested: string[] = [];
  const server: Server = createServer((request, response) => {
    // A server always gives its requests a URL.
    const path = request.url!.split("?")[0]!;
    requested.push(`${request.method} ${request.url}`);
    const redirect = redirects[path];
    const page = pages[path];
    if (redirect !== undefined) {
      response.writeHead(redirect.status, { location: redirect.location }).end();
    } else if (path === "/api/ping") {
      response.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }).end('{"pong":true}');
    } else if (path === "/api/slow") {
      setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end('{"slow":true}'), SLOW_MS);
    } else if (page === undefined) {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
    } else {
      response
        .writeHead(200, { "content-type": "text/html; charset=utf-8" })
        .end(`<!doctype html><html><head><title>${path}</title></head><body>${page}</body></html>`);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requested,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
