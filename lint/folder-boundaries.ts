import { relative, resolve } from "node:path";
import { Boundary, BOUNDARY_MESSAGES } from "./boundary.ts";
import { importVisitor } from "./import-visitor.ts";
import type { Rule } from "./rule.ts";

/** The options of the rule. */
export interface FolderBoundariesOptions {
  /** The folder, from the root of the workspace. */
  readonly directory: string;
  /** The packages of the workspace its files may import. */
  readonly dependsOn: readonly string[];
}

/**
 * Keeps a folder inside a package to fewer packages of the workspace than its package may import, and keeps
 * its files from importing the rest of the package by a relative path. A per-folder override sets it.
 */
export const folderBoundaries: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Keeps a folder to fewer packages of the workspace than its package may import." },
    messages: BOUNDARY_MESSAGES,
    schema: [
      {
        type: "object",
        properties: { directory: { type: "string" }, dependsOn: { type: "array", items: { type: "string" }, uniqueItems: true } },
        required: ["directory", "dependsOn"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ directory, dependsOn }] = context.options as unknown as readonly [FolderBoundariesOptions];
    const boundary = new Boundary(directory, resolve(context.cwd, directory), dependsOn);
    if (!boundary.contains(context.filename)) return {};
    return importVisitor((node, specifier) => {
      const refusal = boundary.refusal(specifier, context.filename, (path) => relative(context.cwd, path));
      if (refusal !== undefined) context.report({ node, ...refusal });
    });
  },
};
