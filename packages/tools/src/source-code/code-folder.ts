import { opendir, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { byCodeUnits } from "@open-qa-stack/domain";
import { globMatcher } from "./glob-pattern.ts";

/** Folders of dependencies and builds, never listed nor searched; hidden folders never are either. */
export const IGNORED_FOLDERS: ReadonlySet<string> = new Set(["build", "coverage", "dist", "node_modules", "out", "target"]);
/** Most files looked at by one listing or search, so that a huge folder cannot stall the agent. */
export const MAX_SCANNED_FILES = 20_000;
/** Largest file read or searched, in bytes. */
export const MAX_FILE_BYTES = 1_000_000;

/** Files of the folder that match a glob, and whether the scan stopped before the end. */
export interface FileList {
  /** Paths relative to the folder, with `/`, in alphabetical order. */
  readonly files: readonly string[];
  /** Whether the most files a listing looks at were looked at before the end of the folder. */
  readonly truncated: boolean;
}

/**
 * A folder of source code, which tools read without ever leaving it.
 *
 * @remarks
 * Every path an agent gives is resolved with its symbolic links and must stay inside the folder. Listings
 * skip symbolic links, the folders in `IGNORED_FOLDERS` and hidden folders, so that they neither leave
 * the folder nor drown in generated files.
 */
export class CodeFolder {
  private readonly declared: string;
  private readonly maxScanned: number;
  private root: Promise<string> | undefined;

  /**
   * @param path - Absolute path of the folder.
   * @param maxScanned - Most files one listing looks at; `MAX_SCANNED_FILES` by default.
   */
  public constructor(path: string, maxScanned = MAX_SCANNED_FILES) {
    this.declared = path;
    this.maxScanned = maxScanned;
  }

  /**
   * Lists the files of the folder.
   *
   * @param glob - Keeps only the files that match it, when given.
   * @returns The files, relative to the folder.
   * @throws Error when the folder does not exist.
   */
  public async list(glob?: string): Promise<FileList> {
    const root = await this.rootPath();
    const matches = glob === undefined ? () => true : globMatcher(glob);
    const files: string[] = [];
    let scanned = 0;
    const walk = async (folder: string): Promise<boolean> => {
      for await (const entry of await opendir(folder)) {
        const path = join(folder, entry.name);
        if (entry.isDirectory() && !IGNORED_FOLDERS.has(entry.name) && !entry.name.startsWith(".")) {
          if (!(await walk(path))) return false;
        } else if (entry.isFile()) {
          if (++scanned > this.maxScanned) return false;
          const file = relative(root, path).split(sep).join("/");
          if (matches(file)) files.push(file);
        }
      }
      return true;
    };
    const complete = await walk(root);
    return { files: files.sort(byCodeUnits), truncated: !complete };
  }

  /**
   * Reads a file of the folder.
   *
   * @param path - Path relative to the folder.
   * @returns Its text.
   * @throws Error when the path leads outside the folder, is not a file, is too large, is binary or cannot
   * be read.
   */
  public async read(path: string): Promise<string> {
    const file = await this.resolve(path);
    const { size, isFile } = await stat(file).then((s) => ({ size: s.size, isFile: s.isFile() }));
    if (!isFile) throw new Error(`${path} is not a file of the folder.`);
    if (size > MAX_FILE_BYTES) throw new Error(`${path} is larger than ${MAX_FILE_BYTES} bytes.`);
    const text = await readFile(file, "utf8");
    if (text.includes("\0")) throw new Error(`${path} is a binary file.`);
    return text;
  }

  /**
   * Resolves a path given by an agent.
   *
   * @param path - Path relative to the folder.
   * @returns Its absolute path, links resolved, inside the folder.
   * @throws Error when it does not exist or leads outside the folder.
   */
  public async resolve(path: string): Promise<string> {
    const root = await this.rootPath();
    const resolved = await realpath(resolve(root, path)).catch(() => {
      throw new Error(`${path} does not exist in the folder.`);
    });
    const inside = relative(root, resolved);
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error(`${path} leads outside the folder.`);
    return resolved;
  }

  /**
   * The folder itself.
   *
   * @returns Its absolute path, links resolved.
   * @throws Error when it does not exist.
   */
  public rootPath(): Promise<string> {
    this.root ??= realpath(this.declared).catch(() => {
      this.root = undefined;
      throw new Error(`The source code folder ${this.declared} does not exist.`);
    });
    return this.root;
  }
}
