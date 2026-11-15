import { createRequire } from "node:module";

/**
 * The version of Playwright the browser tools run with: the one a test repository is initialised at, so that
 * the agents explore an application and its tests run with the same browser automation.
 *
 * @returns The exact version of the `playwright-core` package installed, such as `1.64.1`.
 */
export function playwrightVersion(): string {
  const manifest = createRequire(import.meta.url)("playwright-core/package.json") as { version: string };
  return manifest.version;
}
