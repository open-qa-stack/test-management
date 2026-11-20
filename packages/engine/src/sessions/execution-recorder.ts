import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_REPOSITORY, executionResults, type Execution, type ExecutionStorePort } from "@open-qa-stack/domain";
import { testDigests } from "@open-qa-stack/tools";
import type { Configuration } from "../configuration/configuration.ts";

/** Most bytes git may write out for one file of tests. */
const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;

/** A file of tests when an execution is kept: its digest and those of its tests as they are, and as they are in the commit. */
interface FileVersion {
  /** Left out, as are the digests of its tests, when the file cannot be read. */
  readonly fileDigest?: string;
  readonly tests: ReadonlyMap<string, string>;
  /** Left out for a test repository without a commit. */
  readonly committed?: ReadonlyMap<string, string>;
}

/** What the recorder of the executions works with. */
export interface RecorderOptions {
  /** Absolute path of the test repository the tests ran in. */
  readonly repository: string;
  /** The operations on the configuration, whose revision in step names the folder of the applications. */
  readonly configuration: Configuration;
  /** Where the executions are kept. */
  readonly store: ExecutionStorePort;
  /** The clock that dates the execution. */
  readonly now: () => Date;
}

/**
 * Keeps an execution of tests — those a session of design ran, or those a person launched — from the report the runner wrote: what came of each
 * test, named by the path of its file and its titles, with the version it ran at — the commit of the test
 * repository, the SHA-256 of the file of the test, and that of the test itself without its comments nor its layout,
 * with whether the test was the same in the commit. The store numbers the versions of each test by the latter.
 */
export class ExecutionRecorder {
  readonly #options: RecorderOptions;

  /** @param options - The test repository, its configuration, and where the executions are kept. */
  constructor(options: RecorderOptions) {
    this.#options = options;
  }

  /**
   * Keeps an execution of tests.
   *
   * @param report - The report of the runner, relative to the test repository.
   * @param source - Where the execution comes from: its origin, and the session that ran the tests or the campaign they were launched for.
   * @returns The execution kept; `undefined` when the report cannot be read, and nothing is kept.
   * @throws When the store refuses the execution.
   */
  async record(report: string, source: Pick<Execution, "origin" | "sessionId" | "campaignId">): Promise<Execution | undefined> {
    const { repository, configuration, store, now } = this.#options;
    const json = await readFile(join(repository, report), "utf8").catch(() => "");
    const { appsDir } = { ...DEFAULT_REPOSITORY, ...(await configuration.inStep())?.document.repository };
    const results = executionResults(json, appsDir);
    if (results === undefined) return undefined;
    const commit = await this.#commit();
    const files = new Map<string, FileVersion>();
    for (const { path } of results) if (!files.has(path)) files.set(path, await this.#version(path, commit));
    const execution: Execution = {
      id: randomUUID(),
      ...source,
      ranAt: now().toISOString(),
      ...(commit === undefined ? {} : { commit }),
      report,
      results: results.map((result) => {
        const { fileDigest, tests, committed } = files.get(result.path)!;
        const testDigest = tests.get(result.title);
        return {
          ...result,
          ...(fileDigest === undefined ? {} : { fileDigest }),
          ...(testDigest === undefined ? {} : { testDigest }),
          ...(testDigest === undefined || committed === undefined ? {} : { committed: committed.get(result.title) === testDigest }),
        };
      }),
    };
    await store.add(execution);
    return execution;
  }

  /** A file of tests of the test repository as it is, and its tests as they are in the commit. */
  async #version(path: string, commit: string | undefined): Promise<FileVersion> {
    const bytes = await readFile(join(this.#options.repository, path)).catch(() => undefined);
    if (bytes === undefined) return { tests: new Map() };
    // A file the commit does not hold has no test in it.
    const committed = commit === undefined ? undefined : await testDigests((await this.#git("show", `${commit}:./${path}`)) ?? "");
    return {
      fileDigest: createHash("sha256").update(bytes).digest("hex"),
      tests: await testDigests(bytes.toString("utf8")),
      ...(committed === undefined ? {} : { committed }),
    };
  }

  /** The commit the test repository is at; `undefined` for a folder that has none. */
  async #commit(): Promise<string | undefined> {
    return (await this.#git("rev-parse", "--verify", "HEAD"))?.trim();
  }

  /** What git writes out in the test repository; `undefined` when it fails. */
  #git(...args: string[]): Promise<string | undefined> {
    return new Promise((resolve) =>
      execFile("git", args, { cwd: this.#options.repository, maxBuffer: GIT_OUTPUT_LIMIT }, (error, stdout) => resolve(error === null ? stdout : undefined)),
    );
  }
}
