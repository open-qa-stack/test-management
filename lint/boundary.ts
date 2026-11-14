import { dirname, resolve } from "node:path";
import { installedModule, isPath, isWithin, packageName, WORKSPACE_SCOPE } from "./specifier.ts";

/** The messages of the rules that keep a folder within its boundary. */
export const BOUNDARY_MESSAGES = {
  forbidden: "{{source}} may not import {{target}}; among the packages of the workspace, it may import {{allowed}}.",
  external: "{{source}} may not import {{target}}; among the external modules, it may import {{allowed}}.",
  relative: "{{source}} may not import {{target}} by a relative path that leaves its folder.",
} as const;

/** Why a boundary refuses an import, as a rule reports it. */
export interface Refusal {
  readonly messageId: keyof typeof BOUNDARY_MESSAGES;
  readonly data: { readonly source: string; readonly target: string; readonly allowed: string };
}

/** A folder of the workspace and the modules its files may import from outside it. */
export class Boundary {
  /** How refusals name the folder. */
  readonly name: string;
  /** The absolute path of the folder. */
  readonly folder: string;
  private readonly dependsOn: readonly string[];
  private readonly external: readonly string[] | undefined;

  /**
   * @param name - How refusals name the folder: the name of its package, or its path.
   * @param folder - The absolute path of the folder.
   * @param dependsOn - The packages of the workspace its files may import.
   * @param external - The external modules its files may import, by package name; any of them when omitted.
   */
  constructor(name: string, folder: string, dependsOn: readonly string[], external?: readonly string[]) {
    this.name = name;
    this.folder = folder;
    this.dependsOn = dependsOn;
    this.external = external;
  }

  /**
   * Tells whether a file lies inside the folder.
   *
   * @param path - The absolute path of the file.
   */
  contains(path: string): boolean {
    return isWithin(this.folder, path);
  }

  /**
   * Tells why the boundary refuses an import of one of its files, if it does.
   *
   * A path through a folder of installed packages is judged by the name of the package it reaches.
   *
   * @param specifier - The module the file imports, as the import writes it.
   * @param file - The absolute path of the file.
   * @param nameAt - How to name the target of a path out of the folder: the name of its package, or its path.
   * @returns The refusal, or `undefined` when the import is allowed.
   */
  refusal(specifier: string, file: string, nameAt: (path: string) => string): Refusal | undefined {
    if (isPath(specifier)) {
      const path = resolve(dirname(file), specifier);
      const installed = installedModule(path);
      if (installed !== undefined) return this.moduleRefusal(installed);
      if (this.contains(path)) return undefined;
      const target = nameAt(path);
      return this.packageRefusal(target) ?? this.refused("relative", target, this.dependsOn);
    }
    return this.moduleRefusal(specifier);
  }

  /**
   * Tells why the boundary refuses an import of a module by the name of its package, if it does.
   *
   * @param specifier - The name of the package, with or without a path into it.
   * @returns The refusal, or `undefined` when the import is allowed.
   */
  private moduleRefusal(specifier: string): Refusal | undefined {
    const target = packageName(specifier);
    if (target.startsWith(WORKSPACE_SCOPE)) return this.packageRefusal(target);
    return this.external === undefined || this.external.includes(target) ? undefined : this.refused("external", target, this.external);
  }

  /**
   * Tells why the boundary refuses a dependency on a package of the workspace, if it does.
   *
   * @param target - A package name or a path; only a package of the workspace can be refused.
   * @returns The refusal, or `undefined` when the target is not a package of the workspace or may be imported.
   */
  packageRefusal(target: string): Refusal | undefined {
    const allowed = !target.startsWith(WORKSPACE_SCOPE) || target === this.name || this.dependsOn.includes(target);
    return allowed ? undefined : this.refused("forbidden", target, this.dependsOn);
  }

  private refused(messageId: Refusal["messageId"], target: string, allowed: readonly string[]): Refusal {
    return { messageId, data: { source: this.name, target, allowed: allowed.length === 0 ? "none" : allowed.join(", ") } };
  }
}
