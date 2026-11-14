import { BOUNDARY_MESSAGES } from "./boundary.ts";
import { importVisitor } from "./import-visitor.ts";
import { PackageTable, type PackageEntries } from "./package-table.ts";
import type { Rule } from "./rule.ts";

/** The options of the rule. */
export interface PackageBoundariesOptions {
  /** The packages of the workspace, by name. */
  readonly packages: PackageEntries;
}

/** The schema of a list of package names. */
const NAMES = { type: "array", items: { type: "string" }, uniqueItems: true } as const;

/**
 * Keeps each package of the workspace within the dependencies its table allows: a file of a package imports
 * only the packages of the workspace it depends on, whatever the form of the import, never another package by
 * a relative path, and, when its entry lists them, only the external modules it allows.
 */
export const packageBoundaries: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Keeps each package of the workspace within the dependencies its table allows." },
    messages: BOUNDARY_MESSAGES,
    schema: [
      {
        type: "object",
        properties: {
          packages: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: { directory: { type: "string" }, dependsOn: NAMES, external: NAMES },
              required: ["directory", "dependsOn"],
              additionalProperties: false,
            },
          },
        },
        required: ["packages"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ packages }] = context.options as unknown as readonly [PackageBoundariesOptions];
    const table = new PackageTable(packages, context.cwd);
    const boundary = table.boundaryOf(context.filename);
    if (boundary === undefined) return {};
    return importVisitor((node, specifier) => {
      const refusal = boundary.refusal(specifier, context.filename, (path) => table.nameAt(path));
      if (refusal !== undefined) context.report({ node, ...refusal });
    });
  },
};
