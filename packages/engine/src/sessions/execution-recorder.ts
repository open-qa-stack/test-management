import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_REPOSITORY, executionResults, type Execution, type ExecutionStorePort } from "@open-qa-stack/domain";
import type { Configuration } from "../configuration/configuration.ts";

/** What the recorder of the executions of a session works with. */
export interface RecorderOptions {
  /** Absolute path of the test repository the session ran its tests in. */
  readonly repository: string;
  /** The operations on the configuration, whose revision in step names the folder of the applications. */
  readonly configuration: Configuration;
  /** Where the executions are kept. */
  readonly store: ExecutionStorePort;
  /** The clock that dates the execution. */
  readonly now: () => Date;
}

/**
 * Keeps the execution of the tests a session of design ran, from the report the runner wrote: what came of each
 * test, named by the path of its file and its titles, with the version it ran at — the commit of the test
 * repository and the SHA-256 of the file of the test, which tells a change not committed yet.
 */
export class ExecutionRecorder {
  readonly #options: RecorderOptions;

  /** @param options - The test repository, its configuration, and where the executions are kept. */
  constructor(options: RecorderOptions) {
    this.#options = options;
  }

  /**
   * Keeps the execution of a session.
   *
   * @param sessionId - The session that ran the tests.
   * @param report - The report of the runner, relative to the test repository.
   * @returns The execution kept; `undefined` when the report cannot be read, and nothing is kept.
   * @throws When the store refuses the execution.
   */
  async record(sessionId: string, report: string): Promise<Execution | undefined> {
    const { repository, configuration, store, now } = this.#options;
    const json = await readFile(join(repository, report), "utf8").catch(() => "");
    const { appsDir } = { ...DEFAULT_REPOSITORY, ...(await configuration.inStep())?.document.repository };
    const results = executionResults(json, appsDir);
    if (results === undefined) return undefined;
    const digests = new Map<string, string | undefined>();
    for (const { path } of results) if (!digests.has(path)) digests.set(path, await this.#digest(path));
    const commit = await this.#commit();
    const execution: Execution = {
      id: randomUUID(),
      origin: "design",
      sessionId,
      ranAt: now().toISOString(),
      ...(commit === undefined ? {} : { commit }),
      report,
      results: results.map((result) => {
        const fileDigest = digests.get(result.path);
        return fileDigest === undefined ? result : { ...result, fileDigest };
      }),
    };
    await store.add(execution);
    return execution;
  }

  /** The SHA-256 of a file of the test repository, in hexadecimal; `undefined` when it cannot be read. */
  async #digest(path: string): Promise<string | undefined> {
    const bytes = await readFile(join(this.#options.repository, path)).catch(() => undefined);
    return bytes === undefined ? undefined : createHash("sha256").update(bytes).digest("hex");
  }

  /** The commit the test repository is at; `undefined` for a folder that has none. */
  #commit(): Promise<string | undefined> {
    return new Promise((resolve) =>
      execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd: this.#options.repository }, (error, stdout) =>
        resolve(error === null ? stdout.trim() : undefined),
      ),
    );
  }
}
