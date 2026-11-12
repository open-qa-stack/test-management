import { Worker } from "node:worker_threads";
import type { CodeFolder } from "./code-folder.ts";
import type { SearchOutcome, SearchTask } from "./search-worker.ts";
import type { SearchMatch } from "./text-search.ts";

/** Longest a search may run, in milliseconds, before it is stopped. */
export const SEARCH_TIMEOUT_MS = 10_000;

/** What an agent looks for. */
export interface CodeQuery {
  /** The text, or the regular expression, to find in each line. */
  readonly pattern: string;
  /** Whether `pattern` is a regular expression. */
  readonly regex: boolean;
  /** Whether case matters. */
  readonly caseSensitive: boolean;
  /** Keeps only the files that match this glob, when given. */
  readonly glob?: string;
  /** Lines to give before and after each match. */
  readonly context: number;
  /** Most matches to return. */
  readonly limit: number;
}

/** The matches of a search. */
export interface CodeSearchResult {
  readonly matches: readonly SearchMatch[];
  /** Whether more matches, or more files, were left out. */
  readonly truncated: boolean;
  /** Files not searched, because they are larger than a megabyte or binary. */
  readonly skipped: readonly string[];
}

/**
 * Searches the files of a folder, line by line.
 *
 * @remarks
 * The search runs in a worker thread stopped after `timeoutMs`, so that a regular expression that
 * backtracks without end cannot stall the agent.
 *
 * @param folder - The folder.
 * @param query - What to find, and where.
 * @param timeoutMs - Longest the search may run.
 * @returns The matches.
 * @throws Error when the pattern is not a valid regular expression, the folder does not exist, or the
 * search runs out of time.
 */
export async function searchCode(folder: CodeFolder, query: CodeQuery, timeoutMs = SEARCH_TIMEOUT_MS): Promise<CodeSearchResult> {
  const source = query.regex ? query.pattern : query.pattern.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");
  const flags = query.caseSensitive ? "" : "i";
  try {
    new RegExp(source, flags);
  } catch (invalid) {
    throw new Error(`The pattern is not a valid regular expression: ${(invalid as Error).message}`);
  }
  const { files, truncated } = await folder.list(query.glob);
  const task: SearchTask = { root: await folder.rootPath(), files, source, flags, context: query.context, limit: query.limit };
  const outcome = await inWorker(task, timeoutMs);
  return { matches: outcome.matches, truncated: outcome.truncated || truncated, skipped: outcome.skipped };
}

function inWorker(task: SearchTask, timeoutMs: number): Promise<SearchOutcome> {
  const worker = new Worker(new URL("./search-worker.ts", import.meta.url), { workerData: task });
  return new Promise<SearchOutcome>((resolve, reject) => {
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`The search took longer than ${timeoutMs} ms and was stopped; narrow it with a glob or a simpler pattern.`));
    }, timeoutMs);
    worker.once("message", (outcome: SearchOutcome) => {
      clearTimeout(timer);
      resolve(outcome);
    });
    worker.once("error", (failure) => {
      clearTimeout(timer);
      reject(failure);
    });
  });
}
