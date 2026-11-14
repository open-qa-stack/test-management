import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { BOUNDARY_MESSAGES } from "./boundary.ts";
import type { PackageBoundariesOptions } from "./package-boundaries.ts";
import { PackageTable } from "./package-table.ts";

/** The name under which the lint configuration sets the rule whose table the check reads. */
const RULE = "open-qa-stack/package-boundaries";

/** The fields of a manifest whose dependencies a package needs once installed. */
const FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;

/** What the check reads of a lint configuration. */
interface LintConfiguration {
  readonly rules?: Readonly<Record<string, unknown>>;
  readonly overrides?: readonly { readonly rules?: Readonly<Record<string, unknown>> }[];
}

/**
 * Checks that the manifest of each package of the table declares, among the packages of the workspace, only
 * those the table lets the package depend on. The dependencies of its tests, under `devDependencies`, are left
 * out, as the rule leaves out the files of the tests.
 */
export class ManifestCheck {
  private readonly table: PackageTable;
  private readonly root: string;

  /**
   * @param table - The packages and what each may depend on.
   * @param root - The absolute path of the root of the workspace.
   */
  constructor(table: PackageTable, root: string) {
    this.table = table;
    this.root = root;
  }

  /**
   * The check of a workspace, by the table its lint configuration gives the rule.
   *
   * @param root - The absolute path of the root of the workspace, which holds `.oxlintrc.json`.
   * @throws When the configuration does not set the rule with its table.
   */
  static async of(root: string): Promise<ManifestCheck> {
    const configuration = JSON.parse(await readFile(join(root, ".oxlintrc.json"), "utf8")) as LintConfiguration;
    const settings = [configuration.rules, ...(configuration.overrides ?? []).map((override) => override.rules)].map((rules) => rules?.[RULE]);
    const options = settings.find(Array.isArray) as readonly [unknown, PackageBoundariesOptions] | undefined;
    if (options === undefined) throw new Error(`.oxlintrc.json does not set ${RULE} with its table of packages.`);
    return new ManifestCheck(new PackageTable(options[1].packages, root), root);
  }

  /**
   * Reads the manifest of each package of the table that has one.
   *
   * @returns Each refused dependency, one line each, which names the manifest, the line, the package, the
   *   dependency and the rule; empty when every manifest keeps to the table.
   */
  async violations(): Promise<string[]> {
    const lines: string[] = [];
    for (const boundary of this.table.boundaries) {
      const path = join(boundary.folder, "package.json");
      if (!existsSync(path)) continue;
      const text = await readFile(path, "utf8");
      const manifest = JSON.parse(text) as Partial<Record<(typeof FIELDS)[number], Record<string, string>>>;
      for (const field of FIELDS) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          const refusal = boundary.packageRefusal(name);
          if (refusal === undefined) continue;
          const message = BOUNDARY_MESSAGES[refusal.messageId].replace(/\{\{(\w+)\}\}/g, (_, key: keyof typeof refusal.data) => refusal.data[key]);
          lines.push(`${relative(this.root, path)}:${lineOf(text, field, name)}: ${message} (${field}) [${RULE}]`);
        }
      }
    }
    return lines;
  }
}

/** The line, from 1, where a manifest declares a dependency in a field. */
function lineOf(text: string, field: string, name: string): number {
  return text.slice(0, text.indexOf(`"${name}"`, text.indexOf(`"${field}"`))).split("\n").length;
}
