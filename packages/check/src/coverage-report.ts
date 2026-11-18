import { relative, resolve } from "node:path";

/** What the tests covered of a file: for lines, branches and functions, how many were found and how many were run. */
export interface FileCoverage {
  readonly lines: Counts;
  readonly branches: Counts;
  readonly functions: Counts;
}

/** How many items of a kind a file has, and how many of them the tests ran. */
export interface Counts {
  readonly found: number;
  readonly hit: number;
}

/**
 * Reads a coverage report in the LCOV format, as the `lcov` reporter of the Node.js test runner writes it.
 *
 * @param text - The report.
 * @param root - The folder its relative paths start from.
 * @returns The coverage of each file of the report, by its absolute path.
 */
export function readCoverageReport(text: string, root: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  for (const record of text.split("end_of_record")) {
    const fields = new Map<string, string>();
    for (const line of record.split("\n")) {
      const separator = line.indexOf(":");
      if (separator > 0) fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    const file = fields.get("SF");
    if (file === undefined) continue;
    const counts = (found: string, hit: string): Counts => ({ found: Number(fields.get(found) ?? 0), hit: Number(fields.get(hit) ?? 0) });
    files.set(resolve(root, file), { lines: counts("LF", "LH"), branches: counts("BRF", "BRH"), functions: counts("FNF", "FNH") });
  }
  return files;
}

/**
 * Writes the paths of a coverage report in the LCOV format from another folder, so that reports written from the
 * folders of several packages read as one report of the workspace.
 *
 * @param text - The report.
 * @param from - The folder its relative paths start from.
 * @param to - The folder the paths of the report it gives start from.
 * @returns The same report, each of its paths relative to `to`, with `/` between the folders.
 */
export function rebasedCoverageReport(text: string, from: string, to: string): string {
  return text.replace(/^SF:(.*)$/gm, (_line, file: string) => `SF:${relative(to, resolve(from, file.trim())).split("\\").join("/")}`);
}
