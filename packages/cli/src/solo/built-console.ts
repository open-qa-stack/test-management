import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { UsageError } from "./usage-error.ts";

/** The package that holds the console, and the folder its build writes. */
const CONSOLE_PACKAGE = "@open-qa-stack/web";
const BUILD_FOLDER = "dist";

/**
 * Finds the built console the command serves: the build of the package of the console, wherever that package
 * is installed for the command — in the workspace, its folder under `apps/`.
 *
 * @param folder - The folder to serve instead, when the command was given one.
 * @returns The absolute folder of the build, which holds its page.
 * @throws {@link UsageError} when the folder holds no page: the console was not built, and the message says what to run.
 */
export function builtConsole(folder?: string): string {
  const build = folder ?? join(dirname(createRequire(import.meta.url).resolve(`${CONSOLE_PACKAGE}/package.json`)), BUILD_FOLDER);
  if (!existsSync(join(build, "index.html")))
    throw new UsageError(`The console is not built: ${build} holds no index.html. Run pnpm build at the root of the workspace, then oqas --ui again.`);
  return build;
}
