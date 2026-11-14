import { sep } from "node:path";

/** The npm scope of the packages of the workspace. */
export const WORKSPACE_SCOPE = "@open-qa-stack/";

/**
 * Tells whether a module specifier is a path, relative or absolute, rather than the name of a package.
 *
 * @param specifier - The specifier, as the import writes it.
 */
export function isPath(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

/**
 * The package a module specifier names, without the path into the package.
 *
 * @param specifier - The specifier of a package, such as `@open-qa-stack/shared/schema` or `node:fs/promises`.
 * @returns The name of the package, such as `@open-qa-stack/shared` or `node:fs`.
 */
export function packageName(specifier: string): string {
  return specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
}

/**
 * Tells whether a path is a folder or lies inside it.
 *
 * @param folder - The absolute path of the folder.
 * @param path - The absolute path to place.
 */
export function isWithin(folder: string, path: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

/** The folder of the installed packages, through whose links a path can reach any package. */
const NODE_MODULES = `${sep}node_modules${sep}`;

/**
 * The package a path reaches through a folder of installed packages, as a specifier names it.
 *
 * @param path - The absolute path of the module.
 * @returns What follows the last folder of installed packages, such as `@open-qa-stack/shared/src/index.ts`, or
 * `undefined` when the path goes through none.
 */
export function installedModule(path: string): string | undefined {
  const folder = path.lastIndexOf(NODE_MODULES);
  return folder === -1 ? undefined : path.slice(folder + NODE_MODULES.length);
}
