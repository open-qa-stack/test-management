import { dirname, relative, resolve } from "node:path";
import { importVisitor } from "./import-visitor.ts";
import type { Rule } from "./rule.ts";
import { installedModule, isPath, isWithin, packageName } from "./specifier.ts";

/** The options of the rule. */
export interface ConfinedImportsOptions {
  /** For each confined package, the only folder, from the root of the workspace, whose files may import it. */
  readonly modules: Readonly<Record<string, string>>;
}

/**
 * Confines a package to one folder of the workspace: any file outside that folder, a test included, that
 * imports the package, a path into it, or a path that reaches it through a folder of installed packages is
 * refused.
 */
export const confinedImports: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Confines a package to the one folder of the workspace that may import it." },
    messages: { confined: "{{file}} may not import {{module}}: only the files under {{directory}} may." },
    schema: [
      {
        type: "object",
        properties: { modules: { type: "object", additionalProperties: { type: "string" } } },
        required: ["modules"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const [{ modules }] = context.options as unknown as readonly [ConfinedImportsOptions];
    const folders = new Map(Object.entries(modules));
    return importVisitor((node, specifier) => {
      const target = isPath(specifier) ? installedModule(resolve(dirname(context.filename), specifier)) : specifier;
      const directory = target === undefined ? undefined : folders.get(packageName(target));
      if (directory === undefined || isWithin(resolve(context.cwd, directory), context.filename)) return;
      context.report({ node, messageId: "confined", data: { file: relative(context.cwd, context.filename), module: specifier, directory } });
    });
  },
};
