import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { Logger } from "@nestjs/common";
import { isRecord, parseJson } from "../json.ts";
import { BriefSearch } from "./brief-search.ts";
import { compareText } from "./compare-text.ts";
import type { Project, Session, SessionResult, SessionTest, TestVerdict } from "@open-qa-stack/shared/sessions";
import type { RunFiles } from "./run-files.ts";
import type { RunProgress } from "./run-progress.ts";

/** How long a run may stay silent before it is called interrupted, in milliseconds. */
export const SILENCE_MS = 10 * 60_000;

/** The configuration of a test repository, as the command line names it. */
const CONFIGURATION = "oqas.json";

/** The state folder of a test repository whose configuration declares none. */
const STATE_FOLDER = ".oqas";

/** The name of the journal of a run, which gives its identifier. */
const JOURNAL = /^(oqas-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.jsonl$/;

/**
 * What the name of the inbox of a run ends on, after the identifier of the run: the command line reads the
 * messages of a person from `runs/oqas-<date>.inbox.jsonl`. It mirrors the command line, whose packages the
 * API does not import.
 */
const INBOX_SUFFIX = ".inbox.jsonl";

/** The name of a trace, which ends on the date it started, written as in the identifier of a run. */
const TRACE = /-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.jsonl$/;

/** How a run ended, by the exit code of the command; any other code is a run that did not go to its end. */
const OUTCOMES: ReadonlyMap<unknown, SessionResult["outcome"]> = new Map([
  [0, "passed"],
  [1, "failed"],
  [2, "inconclusive"],
]);

/** The verdicts a client knows. */
const VERDICTS = ["passed", "failed", "blocked", "indeterminate", "skipped", "not_run"] as const satisfies readonly TestVerdict[];

/** What a run left on disk: the state it wrote when it ended, if it did, and when it last wrote, in milliseconds. */
interface RunWrites {
  readonly ended: Readonly<Record<string, unknown>> | undefined;
  readonly last: number;
  /** Whether its journal is still there: a run without it is no longer a run of the repository. */
  readonly held: boolean;
}

/** The names a folder holds, sorted; none when it does not exist. */
async function namesIn(folder: string): Promise<string[]> {
  return (await readdir(folder).catch(() => [])).sort(compareText);
}

/** The text a file holds; none when the file is missing. */
function textIn(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

/** The object a JSON file holds; `undefined` when the file is missing, is not JSON yet or holds something else. */
async function recordIn(path: string): Promise<Readonly<Record<string, unknown>> | undefined> {
  const value = parseJson(await textIn(path));
  return isRecord(value) ? value : undefined;
}

/** When a file was last written, in milliseconds; nothing for a file removed since it was listed. */
function writtenAt(path: string): Promise<number[]> {
  return stat(path).then(
    ({ mtimeMs }) => [mtimeMs],
    () => [],
  );
}

/** The date in the identifier of a run, as the name of a trace writes it. */
function startStamp(id: string): string {
  return id.slice("oqas-".length);
}

/** The date in the identifier of a run, as an ISO 8601 date. */
function startOf(id: string): string {
  return startStamp(id).replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
}

/** The verdicts a state lists, those that are whole; a verdict a client does not know is read as no verdict of success or failure. */
function testsOf(tests: unknown): SessionTest[] {
  if (!Array.isArray(tests)) return [];
  return tests.flatMap((test: unknown) => {
    if (!isRecord(test)) return [];
    const { id, verdict, reason } = test;
    if (typeof id !== "string" || typeof reason !== "string") return [];
    return [{ id, verdict: VERDICTS.find((known) => known === verdict) ?? "indeterminate", reason }];
  });
}

/** What a run came to, from the state it wrote when it ended. */
function resultOf(ended: Readonly<Record<string, unknown>>): SessionResult {
  const { exitCode, durationMs, steps, branch, tests } = ended;
  const requests = Array.isArray(steps) ? steps.map((step: unknown) => (isRecord(step) ? step["modelRequests"] : undefined)) : [];
  return {
    outcome: OUTCOMES.get(exitCode) ?? "stopped",
    durationMs: typeof durationMs === "number" ? durationMs : 0,
    modelRequests: requests.reduce<number>((total, count) => total + (typeof count === "number" ? count : 0), 0),
    ...(typeof branch === "string" ? { branch } : {}),
    tests: testsOf(tests),
  };
}

/**
 * What the runs of the `oqas` command line left in a test repository, read as the project and the sessions of
 * an instance. It reads the repository and never writes to it.
 *
 * @remarks
 * The configuration of the repository gives its applications and its state folder. In that folder,
 * `runs/oqas-<date>.jsonl` is the journal of a run, which exists while the run is going, and
 * `runs/oqas-<date>.json` its state, written when it ends; a trace, `traces/<name>-<date>.jsonl`, belongs to
 * the run that started before it and before the next run. `runs/oqas-<date>.inbox.jsonl` is the inbox of a
 * run: what a person sent it. The run does not write it, so it is no sign of life: only the journal, the
 * traces and the state date a run and tell whether it still works.
 *
 * The state folder the configuration declares is only followed inside the repository: the configuration is a
 * file of the repository, which must not make the instance read anywhere else on its machine.
 */
export class RunFolder {
  readonly #root: string;
  readonly #now: () => Date;
  readonly #logger = new Logger("Solo");
  readonly #briefs = new Map<string, BriefSearch>();
  #warned = false;

  /**
   * @param root - The root of the test repository, absolute.
   * @param now - The clock, which tells a run that still writes from one that went silent.
   */
  constructor(root: string, now: () => Date) {
    this.#root = root;
    this.#now = now;
  }

  /** @returns The project: named after the folder of the repository, with the applications its configuration declares. */
  async project(): Promise<Project> {
    const { applications } = await this.#configuration();
    const declared: readonly unknown[] = Array.isArray(applications) ? applications : [];
    return {
      name: basename(this.#root),
      applications: declared.flatMap((application) => {
        if (!isRecord(application)) return [];
        const { id, name } = application;
        return typeof id === "string" ? [{ id, name: typeof name === "string" ? name : id }] : [];
      }),
    };
  }

  /** @returns The files of each run that kept a journal, in the order the runs started. */
  async runs(): Promise<RunFiles[]> {
    const folder = join(this.#root, await this.#stateFolder());
    const ids = (await namesIn(join(folder, "runs"))).flatMap((name) => JOURNAL.exec(name)?.[1] ?? []);
    const traces = (await namesIn(join(folder, "traces")))
      .flatMap((name) => {
        const stamp = TRACE.exec(name)?.[1];
        return stamp === undefined ? [] : [{ name, stamp }];
      })
      .sort((a, b) => compareText(a.stamp, b.stamp));
    return ids.map((id, rank) => {
      const from = startStamp(id);
      const next = ids[rank + 1];
      const until = next === undefined ? undefined : startStamp(next);
      return {
        id,
        journal: join(folder, "runs", `${id}.jsonl`),
        inbox: join(folder, "runs", `${id}${INBOX_SUFFIX}`),
        state: join(folder, "runs", `${id}.json`),
        traces: traces.filter(({ stamp }) => stamp >= from && (until === undefined || stamp < until)).map(({ name }) => join(folder, "traces", name)),
      };
    });
  }

  /**
   * @param id - The identifier of a run.
   * @returns Its files; `undefined` when the repository holds no such run.
   */
  async files(id: string): Promise<RunFiles | undefined> {
    return (await this.runs()).find((run) => run.id === id);
  }

  /** @returns Each run as a session, the latest first. */
  async sessions(): Promise<Session[]> {
    const runs = await this.runs();
    return Promise.all(runs.reverse().map((run) => this.describe(run)));
  }

  /**
   * @param id - The identifier of a run.
   * @returns The run as a session; `undefined` when the repository holds no such run.
   */
  async session(id: string): Promise<Session | undefined> {
    const files = await this.files(id);
    return files === undefined ? undefined : this.describe(files);
  }

  /**
   * Tells where a run is, without reading what it wrote: what is asked at every pace of every stream.
   *
   * @remarks
   * A run is `running` from its journal on, `completed` once its state is written, and `interrupted` when it
   * has no state and wrote nothing for {@link SILENCE_MS}. Its last event is dated by the last write to one of
   * the files it writes, or by its start when none is left; its inbox, which others write, dates nothing.
   *
   * @param files - The files of the run.
   * @returns Its state, and when it last wrote; `undefined` when its journal was removed since its files were
   * listed: with nothing left to date it, such a run would otherwise pass for one that went silent long ago.
   */
  async progress(files: RunFiles): Promise<RunProgress | undefined> {
    const writes = await this.#writesOf(files);
    return writes.held ? this.#progressOf(writes) : undefined;
  }

  /**
   * Describes a run as a session, as it is now.
   *
   * @remarks
   * What was asked comes from its state once it ended, and before that from the brief the harness quotes in
   * its traces, once written.
   *
   * @param files - The files of the run.
   * @returns The session.
   */
  async describe(files: RunFiles): Promise<Session> {
    const { id } = files;
    const writes = await this.#writesOf(files);
    const { ended } = writes;
    const openedAt = startOf(id);
    if (ended === undefined) {
      const request = await this.#brief(files);
      return { id, ...(request === undefined ? {} : { request }), openedAt, ...this.#progressOf(writes) };
    }
    this.#briefs.delete(id);
    const { brief, environment } = ended;
    return {
      id,
      ...(typeof brief === "string" ? { request: brief } : {}),
      ...(typeof environment === "string" ? { environment } : {}),
      openedAt,
      ...this.#progressOf(writes),
      result: resultOf(ended),
    };
  }

  async #writesOf(files: RunFiles): Promise<RunWrites> {
    const ended = await recordIn(files.state);
    const journal = await writtenAt(files.journal);
    const others = await Promise.all([...files.traces, ...(ended === undefined ? [] : [files.state])].map(writtenAt));
    return { ended, last: Math.max(Date.parse(startOf(files.id)), ...journal, ...others.flat()), held: journal.length > 0 };
  }

  #progressOf({ ended, last }: RunWrites): RunProgress {
    const lastEventAt = new Date(last).toISOString();
    if (ended !== undefined) return { state: "completed", lastEventAt };
    return { state: this.#now().getTime() - last > SILENCE_MS ? "interrupted" : "running", lastEventAt };
  }

  /** The brief the traces of a run quote: the search of each run goes on from one description to the next. */
  #brief(files: RunFiles): Promise<string | undefined> {
    const search = this.#briefs.get(files.id) ?? new BriefSearch();
    this.#briefs.set(files.id, search);
    return search.in(files.traces);
  }

  /** The state folder, from the root: the one the configuration declares when it is a path inside the repository, the default one otherwise. */
  async #stateFolder(): Promise<string> {
    const { repository } = await this.#configuration();
    const declared = isRecord(repository) ? repository["stateDir"] : undefined;
    if (declared === undefined) return STATE_FOLDER;
    if (typeof declared === "string" && !isAbsolute(declared) && relative(this.#root, join(this.#root, declared)).split(sep)[0] !== "..") return declared;
    if (!this.#warned) {
      this.#logger.warn(
        `repository.stateDir of ${CONFIGURATION} must be a relative path inside the test repository: the runs are read in ${STATE_FOLDER} instead.`,
      );
      this.#warned = true;
    }
    return STATE_FOLDER;
  }

  async #configuration(): Promise<Readonly<Record<string, unknown>>> {
    return (await recordIn(join(this.#root, CONFIGURATION))) ?? {};
  }
}
