import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import { fixtureConfig, fixtureRepository, git } from "./fixture.ts";

export { git, MODEL, WITNESS } from "./fixture.ts";

/** The folder the test repositories of a test file are made in, removed once the file ran. */
export const workspace = mkdtempSync(join(tmpdir(), "oqas-run-"));

/** The application under test: a server that answers every request. */
export let site: Server;

/** The address of the application under test, known once the tests of the file started. */
export let siteUrl = "";

beforeAll(async () => {
  site = createServer((_request, response) => response.writeHead(200).end("ok"));
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => site.close(() => resolve()));
  rmSync(workspace, { recursive: true, force: true });
});

/** The configuration of a test repository of the file, whose application under test is {@link site}. */
export function configText(modelUrl: string, changes: Record<string, unknown> = {}): string {
  return fixtureConfig(modelUrl, siteUrl, changes);
}

/** A test repository of the file, made in its {@link workspace}. */
export function repository(config: string | undefined): string {
  return fixtureRepository(workspace, config);
}

/** A configuration whose tasks stop at their nth model call. */
export const boundedTo = (maxIterations: number) => (url: string) => configText(url, { autonomy: { level: "bounded", task: { maxIterations } } });

/** Every file git does not track, ignored ones included, but the types the tests are checked against. */
export const untracked = (root: string) =>
  git(root, "status", "--porcelain", "--untracked-files=all", "--ignored")
    .split("\n")
    .filter((line) => line !== "" && !line.includes("node_modules/"))
    .join("\n");
