import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { MAX_FILE_BYTES } from "./code-folder.ts";
import { searchText, type SearchMatch } from "./text-search.ts";

/** What the search worker receives. */
export interface SearchTask {
  readonly root: string;
  readonly files: readonly string[];
  readonly source: string;
  readonly flags: string;
  readonly context: number;
  readonly limit: number;
}

/** What the search worker answers. */
export interface SearchOutcome {
  readonly matches: readonly SearchMatch[];
  /** Whether the search stopped at `limit` matches. */
  readonly truncated: boolean;
  /** Files not searched, because they are larger than `MAX_FILE_BYTES` or binary. */
  readonly skipped: readonly string[];
}

// Runs in a worker thread, so that a pattern that backtracks without end can be stopped from outside.
const task = workerData as SearchTask;
const pattern = new RegExp(task.source, task.flags);
const matches: SearchMatch[] = [];
const skipped: string[] = [];
for (const file of task.files) {
  const path = join(task.root, file);
  const text = statSync(path).size > MAX_FILE_BYTES ? undefined : readFileSync(path, "utf8");
  if (text === undefined || text.includes("\0")) {
    skipped.push(file);
    continue;
  }
  matches.push(...searchText(file, text, pattern, task.context, task.limit + 1 - matches.length));
  if (matches.length > task.limit) break;
}
parentPort!.postMessage({ matches: matches.slice(0, task.limit), truncated: matches.length > task.limit, skipped } satisfies SearchOutcome);
