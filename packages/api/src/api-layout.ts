import multipart from "@fastify/multipart";
import { serveConsole } from "./console/serve-console.ts";
import { serveTraceViewer } from "./console/serve-trace-viewer.ts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/** The path every route of the API is served under: the console asks its instance there, on its own origin. */
export const REST_PREFIX = "/api";

/**
 * Lays out what an application answers, before it listens: its routes under {@link REST_PREFIX}, which read the
 * multipart bodies of the uploads with the plugin of Fastify that parses them, and the console everywhere else when
 * the API was given one, with the trace viewer of Playwright beside it. The address is laid out the same wherever the API runs,
 * behind a proxy or in the process of a command: what is under the prefix is REST, and nothing else is.
 *
 * @param app - The application, not yet initialised.
 * @param console - The absolute folder of the built console; `undefined` for an API that serves its routes alone.
 */
export async function layOut(app: NestFastifyApplication, console: string | undefined): Promise<void> {
  app.setGlobalPrefix(REST_PREFIX);
  // The limits of an upload are those of the route that reads it.
  await app.register(multipart);
  if (console === undefined) return;
  await serveTraceViewer(app);
  await serveConsole(app, console, REST_PREFIX);
}
