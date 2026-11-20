import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import fastifyStatic from "@fastify/static";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/** The path the trace viewer of Playwright is served under, beside the console. */
export const TRACE_VIEWER_PREFIX = "/trace-viewer/";

/** The folder of the trace viewer `playwright-core` ships built: a static application, with its service worker. */
export function traceViewerFolder(): string {
  return join(dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), "lib", "vite", "traceViewer");
}

/**
 * Has an application serve the trace viewer of Playwright under {@link TRACE_VIEWER_PREFIX}, as `playwright-core`
 * builds it, on the origin of the console: the viewer opens a trace by its address, `index.html?trace=<address>`,
 * which its service worker asks for, and a service worker reads only what its own origin serves.
 *
 * @remarks
 * Each of its files is asked again at each visit: a version of `playwright-core` installed later is seen once the API
 * is started again.
 *
 * @param app - The application, not yet initialised.
 */
export async function serveTraceViewer(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyStatic, {
    root: traceViewerFolder(),
    prefix: TRACE_VIEWER_PREFIX,
    decorateReply: false,
    wildcard: false,
    cacheControl: false,
    setHeaders: (reply) => void reply.header("Cache-Control", "no-cache").header("X-Content-Type-Options", "nosniff"),
  });
}
