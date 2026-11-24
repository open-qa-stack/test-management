import { extname, join, sep } from "node:path";
import fastifyStatic from "@fastify/static";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/** The page of the console, which every address of the console that names no file opens. */
export const CONSOLE_PAGE = "index.html";

/** The folder of a build whose files bear a hash of their content in their name: a name is one content for ever. */
const HASHED = "assets";

/**
 * Has an application answer with the console wherever its routes do not, by the plugin that serves a folder:
 * this function is its configuration, and all that ties the console to the HTTP server.
 *
 * @remarks
 * Each file of the build is a route of its own, listed when the API starts — a console built again is served
 * once the API is started again — so that a path which names no file reaches the route declared here: the
 * page of the console when the path reads as a route of the console in the browser, and a route that does not
 * exist, which the API answers with its problem, when it reads as a file or is under the routes of the API. No
 * path under the routes of the API ever opens the page. A hashed file is kept for good by a browser; any
 * other, the page first, is asked again at each visit, so that a new build is seen at once.
 *
 * @param app - The application, not yet initialised.
 * @param folder - The absolute folder of the built console, which holds {@link CONSOLE_PAGE}.
 * @param rest - The path the routes of the API are served under.
 */
export async function serveConsole(app: NestFastifyApplication, folder: string, rest: string): Promise<void> {
  const hashed = join(folder, HASHED) + sep;
  await app.register(fastifyStatic, {
    root: folder,
    wildcard: false,
    cacheControl: false,
    // The type is the one the extension tells, whatever the bytes look like.
    setHeaders: (reply, file) =>
      void reply
        .header("Cache-Control", file.startsWith(hashed) ? "public, max-age=31536000, immutable" : "no-cache")
        .header("X-Content-Type-Options", "nosniff"),
  });
  app
    .getHttpAdapter()
    .getInstance()
    .get("/*", (request, reply) => {
      const path = request.url.split("?", 1)[0]!;
      const elsewhere = path === rest || path.startsWith(`${rest}/`) || extname(path) !== "";
      return elsewhere ? reply.callNotFound() : reply.sendFile(CONSOLE_PAGE);
    });
}
