import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Reads a file of the test repository, refusing any path that leads outside it.
 *
 * @remarks
 * The path is resolved with its symbolic links, so that a link inside the repository cannot lead outside.
 *
 * @param repositoryRoot - Absolute path of the test repository.
 * @param path - Path relative to the repository root.
 * @returns The content of the file.
 * @throws Error when the file leads outside the repository or cannot be read.
 */
export async function readRepositoryFile(repositoryRoot: string, path: string): Promise<string> {
  const root = await realpath(repositoryRoot);
  const file = await realpath(resolve(root, path));
  const inside = relative(root, file);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error(`The file ${path} leads outside the test repository.`);
  }
  return readFile(file, "utf8");
}
