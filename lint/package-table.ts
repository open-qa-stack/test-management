import { relative, resolve } from "node:path";
import { Boundary } from "./boundary.ts";

/** The boundary of a package, as the configuration of the rule declares it. */
export interface PackageEntry {
  /** The folder of the package, from the root of the workspace. */
  readonly directory: string;
  /** The packages of the workspace it may depend on. */
  readonly dependsOn: readonly string[];
  /** The external modules it may import, by package name; any of them when omitted. */
  readonly external?: readonly string[];
}

/** The packages of the workspace, by name, and the boundary of each. */
export type PackageEntries = Readonly<Record<string, PackageEntry>>;

/** The table of the packages of the workspace and of what each may depend on. */
export class PackageTable {
  /** The boundary of each package of the table. */
  readonly boundaries: readonly Boundary[];
  private readonly root: string;

  /**
   * @param packages - The packages, by name.
   * @param root - The absolute path of the root of the workspace, which their folders start from.
   */
  constructor(packages: PackageEntries, root: string) {
    this.root = root;
    this.boundaries = Object.entries(packages).map(
      ([name, { directory, dependsOn, external }]) => new Boundary(name, resolve(root, directory), dependsOn, external),
    );
  }

  /**
   * The boundary of the package a file belongs to.
   *
   * @param path - The absolute path of the file.
   * @returns The boundary, or `undefined` when the file belongs to no package of the table.
   */
  boundaryOf(path: string): Boundary | undefined {
    return this.boundaries.find((boundary) => boundary.contains(path));
  }

  /**
   * How a refusal names a file.
   *
   * @param path - The absolute path of the file.
   * @returns The name of its package, or its path from the root when it belongs to no package of the table.
   */
  nameAt(path: string): string {
    return this.boundaryOf(path)?.name ?? relative(this.root, path);
  }
}
