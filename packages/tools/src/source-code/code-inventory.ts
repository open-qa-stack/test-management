import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import { fingerprintOf } from "../common/fingerprint.ts";
import type { SourceInventory } from "../common/source-inventory.ts";
import type { CodeFolder } from "./code-folder.ts";
import { fileOutline } from "./file-outline.ts";
import { parsedExtensions } from "./syntax-parser.ts";

/** Most folders a card of source code places, so that a large code base stays readable in one card. */
export const MAX_CODE_ITEMS = 40;

/** What the harness knows of a folder of code. */
type FolderFacts = {
  files: number;
  routes: string[];
};

/**
 * Reads what a folder of source code holds, without the model.
 *
 * @remarks
 * Only the files a grammar reads count. The elements are the folders that hold such files, relative to the
 * root of the code, `.` being the root itself. When there are more than `maxItems`, the deepest
 * folders are merged into their parent until there are no more, so that `domain/policy` and
 * `domain/customer` become `domain`. The facts of each are its number of files and the routes their
 * outlines declare. A file that cannot be read counts in no folder. The fingerprint covers the path and the
 * content of every file counted.
 *
 * @param folder - The folder of the code.
 * @param maxItems - Most folders kept; `MAX_CODE_ITEMS` by default.
 * @returns The inventory of the code, its folders in alphabetical order.
 * @throws Error when the folder does not exist, or tree-sitter cannot be loaded.
 */
export async function codeInventory(folder: CodeFolder, maxItems = MAX_CODE_ITEMS): Promise<SourceInventory> {
  const extensions = new Set(parsedExtensions());
  const { files } = await folder.list();
  const folders = new Map<string, FolderFacts>();
  const digests: [string, string][] = [];
  for (const file of files.filter((path) => extensions.has(extname(path).slice(1).toLowerCase()))) {
    const text = await folder.read(file).catch(() => undefined);
    if (text === undefined) continue;
    digests.push([file, createHash("sha256").update(text).digest("hex")]);
    const outline = (await fileOutline(file, text))!; // every file kept has a grammar
    const facts = folders.get(posix.dirname(file)) ?? { files: 0, routes: [] };
    facts.files += 1;
    facts.routes.push(...outline.symbols.filter((symbol) => symbol.kind === "route").map((symbol) => symbol.name));
    folders.set(posix.dirname(file), facts);
  }
  while (folders.size > maxItems) mergeDeepest(folders);
  const items = [...folders.keys()].sort();
  return { items, facts: new Map(items.map((item) => [item, folders.get(item)!])), fingerprint: fingerprintOf(JSON.stringify(digests)) };
}

/** Merges the deepest folder, the last in alphabetical order among those as deep, into its parent. */
function mergeDeepest(folders: Map<string, FolderFacts>): void {
  const depth = (path: string) => (path === "." ? 0 : path.split("/").length);
  const deepest = [...folders.keys()].sort((a, b) => depth(b) - depth(a) || b.localeCompare(a))[0]!;
  const parent = posix.dirname(deepest);
  const merged = folders.get(parent) ?? { files: 0, routes: [] };
  const child = folders.get(deepest)!;
  folders.set(parent, { files: merged.files + child.files, routes: [...merged.routes, ...child.routes] });
  folders.delete(deepest);
}
