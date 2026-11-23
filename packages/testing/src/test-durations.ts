import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

/** How long each test file took, in seconds, by its path from the root of the workspace. */
export type TestDurations = Readonly<Record<string, number>>;

/** What a test runner reports of the files it ran, as Vitest writes it in its JSON report. */
export interface TestReport {
  readonly testResults: readonly { readonly name: string; readonly startTime: number; readonly endTime: number }[];
}

/**
 * Reads how long each test file took in a report: a file run more than once, as those written for every database of
 * the store, keeps its longest run.
 *
 * @param report - The report.
 * @param root - The root of the workspace, from which the paths are written.
 * @returns The durations, the paths in order, each to a tenth of a second.
 */
export function durationsOf(report: TestReport, root: string): TestDurations {
  const durations = new Map<string, number>();
  for (const { name, startTime, endTime } of report.testResults) {
    const path = relative(root, name);
    const seconds = Math.round((endTime - startTime) / 100) / 10;
    durations.set(path, Math.max(durations.get(path) ?? 0, seconds));
  }
  return Object.fromEntries([...durations].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Writes the durations a JSON report of Vitest gives, for the parts of the tests to be balanced by.
 *
 * @param report - The file of the report.
 * @param durations - The file the durations are written to.
 * @param root - The root of the workspace.
 */
export async function writeDurations(report: string, durations: string, root: string): Promise<void> {
  const read = durationsOf(JSON.parse(await readFile(report, "utf8")) as TestReport, root);
  await writeFile(durations, `${JSON.stringify(read, undefined, 2)}\n`);
}

/**
 * Orders test files from the longest to the shortest, so that the longest start first and none is left to run alone at
 * the end: a file whose duration is not known counts as long as the median one; with none known, every file counts the
 * same, in the order of their paths.
 *
 * @param paths - The path of each file, from the root of the workspace; a file run twice is there twice.
 * @param durations - How long the files took.
 * @returns Each file by its rank, with how long it counts, the longest first.
 */
export function longestFirst(paths: readonly string[], durations: TestDurations): { readonly rank: number; readonly seconds: number }[] {
  const known = paths
    .map((path) => durations[path])
    .filter((seconds) => seconds !== undefined)
    .toSorted((a, b) => a - b);
  const median = known[Math.floor(known.length / 2)] ?? 1;
  return paths
    .map((path, rank) => ({ rank, path, seconds: durations[path] ?? median }))
    .toSorted((a, b) => b.seconds - a.seconds || a.path.localeCompare(b.path) || a.rank - b.rank)
    .map(({ rank, seconds }) => ({ rank, seconds }));
}

/**
 * Splits test files into parts of nearly the same length: the longest first, each into the part that holds the least
 * so far, the first of them on a tie, as {@link longestFirst} orders them.
 *
 * @param paths - The path of each file, from the root of the workspace; a file run twice is there twice.
 * @param durations - How long the files took.
 * @param count - The number of parts.
 * @returns The ranks of the files of each part, the parts in order.
 */
export function balancedParts(paths: readonly string[], durations: TestDurations, count: number): number[][] {
  const items = longestFirst(paths, durations);
  const parts = Array.from({ length: count }, () => ({ seconds: 0, ranks: [] as number[] }));
  for (const item of items) {
    const lightest = parts.reduce((least, part) => (part.seconds < least.seconds ? part : least), parts[0]!);
    lightest.seconds += item.seconds;
    lightest.ranks.push(item.rank);
  }
  return parts.map(({ ranks }) => ranks);
}
