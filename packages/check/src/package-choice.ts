import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { GitRepository } from "./git-repository.ts";
import type { WorkspacePackage } from "./workspace-package.ts";

/** What a manifest says of the packages a package depends on. */
interface Dependencies {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

/** Files outside the packages that change nothing the tests run: the documents of the workspace. */
const DOCUMENT = /^(?:[^/]+\.md|docs\/.*)$/;

/**
 * Finds the packages a list names, each by its name or by its folder, with every package that depends on one of them:
 * the code of a package is covered by its tests and by those of the packages that use it.
 *
 * @param root - The root of the workspace.
 * @param packages - The packages of the workspace.
 * @param names - The names or the folders, relative to the root, separated by commas.
 * @returns The names of the packages; or the names that match none.
 */
export async function namedPackages(
  root: string,
  packages: readonly WorkspacePackage[],
  names: string,
): Promise<{ readonly chosen: ReadonlySet<string> } | { readonly unknown: readonly string[] }> {
  const asked = names
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const found = asked.map((name) => packages.find((candidate) => candidate.name === name || relative(root, candidate.path) === name));
  const unknown = asked.filter((_, index) => found[index] === undefined);
  if (unknown.length > 0) return { unknown };
  const beside = packages.filter(({ path }) => path !== root);
  return { chosen: dependentsOf(new Set(found.map((workspacePackage) => workspacePackage!.name)), await dependencies(beside)) };
}

/**
 * Finds the packages a change touches since a revision: those whose files it changed, then every package that depends on one
 * of them, directly or not. A change outside the packages, but for the documents of the workspace, touches them all.
 *
 * @remarks
 * The change is that of the working tree since the revision the current one shares with it, files not yet committed and
 * files git does not track yet included.
 *
 * @param root - The root of the workspace.
 * @param packages - The packages of the workspace.
 * @param since - The revision the change is read from, such as the base branch of a pull request.
 * @returns The names of the packages touched; `undefined` when every package is.
 */
export async function touchedPackages(root: string, packages: readonly WorkspacePackage[], since: string): Promise<ReadonlySet<string> | undefined> {
  const git = new GitRepository(root);
  const base = (await git.read(["merge-base", since, "HEAD"])).trim();
  // Both lists give the paths from the root of the workspace, which may be a folder of its repository.
  const listed = [
    ...(await git.read(["diff", "--name-only", "--relative", base])).split("\n"),
    ...(await git.read(["ls-files", "--others", "--exclude-standard"])).split("\n"),
  ];
  const files = listed.filter((file) => file !== "").map((file) => join(root, file));
  const beside = packages.filter(({ path }) => path !== root);
  const owners = new Set<string>();
  for (const file of files) {
    const owner = beside.find(({ path }) => file === path || file.startsWith(`${path}${sep}`));
    if (owner !== undefined) owners.add(owner.name);
    else if (!DOCUMENT.test(relative(root, file).split(sep).join("/"))) return undefined;
  }
  return dependentsOf(owners, await dependencies(beside));
}

/** The workspace packages each package depends on, by name. */
async function dependencies(packages: readonly WorkspacePackage[]): Promise<Map<string, readonly string[]>> {
  const names = new Set(packages.map(({ name }) => name));
  const entries = await Promise.all(
    packages.map(async ({ name, path }) => {
      const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8")) as Dependencies;
      const all = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
      return [name, Object.keys(all).filter((dependency) => names.has(dependency))] as const;
    }),
  );
  return new Map(entries);
}

/** The packages touched, and every package that depends on one of them, directly or not. */
function dependentsOf(touched: ReadonlySet<string>, dependsOn: ReadonlyMap<string, readonly string[]>): Set<string> {
  const all = new Set(touched);
  let grown = true;
  while (grown) {
    grown = false;
    for (const [name, needs] of dependsOn)
      if (!all.has(name) && needs.some((need) => all.has(need))) {
        all.add(name);
        grown = true;
      }
  }
  return all;
}

/**
 * Says which packages a change touches, as the check tells it.
 *
 * @param since - The revision the change is read from.
 * @param touched - The names of the packages touched; `undefined` when every package is.
 * @returns The line.
 */
export function touchedLine(since: string, touched: ReadonlySet<string> | undefined): string {
  const named = touched === undefined ? "all of them" : [...touched].sort((one, other) => one.localeCompare(other)).join(", ") || "none";
  return `check: the packages touched since ${since}: ${named}`;
}
