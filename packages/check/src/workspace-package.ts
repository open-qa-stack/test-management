import { execFile } from "node:child_process";
import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/** A package of the workspace, as the check sees it. */
export interface WorkspacePackage {
  readonly name: string;
  /** Its folder, absolute. */
  readonly path: string;
  /** Its `test` script, if it has one. */
  readonly testScript: string | undefined;
  /** The files under its `src` folder, absolute. */
  readonly sources: readonly string[];
  /**
   * The files its manifest lists under `coverage.measuredInBrowser`, absolute: modules that only run in a browser,
   * whose coverage its own tests measure there.
   */
  readonly measuredInBrowser: ReadonlySet<string>;
  /**
   * The files its manifest lists under `coverage.runAsProgram`, absolute: the entry points its tests start as
   * programs of their own, which a test runner that measures its own process alone cannot see.
   */
  readonly runAsProgram: ReadonlySet<string>;
}

/** What the check reads of the manifest of a package. */
interface Manifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly coverage?: { readonly measuredInBrowser?: readonly string[]; readonly runAsProgram?: readonly string[] };
}

/**
 * Lists the packages of a workspace, its root included, as pnpm finds them.
 *
 * @param root - The root of the workspace.
 * @returns Each package with its test script, its source files, those its tests measure in a browser and those they run as programs.
 */
export async function workspacePackages(root: string): Promise<WorkspacePackage[]> {
  const { stdout } = await promisify(execFile)("pnpm", ["ls", "--recursive", "--depth", "-1", "--json"], { cwd: root });
  const listed = JSON.parse(stdout) as { name: string; path: string }[];
  return Promise.all(
    listed.map(async ({ name, path }) => {
      const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as Manifest;
      return {
        name,
        path,
        testScript: manifest.scripts?.["test"],
        sources: await sourcesOf(path),
        measuredInBrowser: new Set((manifest.coverage?.measuredInBrowser ?? []).map((file) => join(path, file))),
        runAsProgram: new Set((manifest.coverage?.runAsProgram ?? []).map((file) => join(path, file))),
      };
    }),
  );
}

async function sourcesOf(path: string): Promise<string[]> {
  const sources: string[] = [];
  for await (const entry of glob("src/**", { cwd: path, withFileTypes: true })) {
    if (entry.isFile()) sources.push(join(entry.parentPath, entry.name));
  }
  // By their code units, as git lists paths: the same order on every machine.
  return sources.sort((a, b) => Number(a > b) - Number(a < b));
}
