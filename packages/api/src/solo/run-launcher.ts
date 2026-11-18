import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { Logger } from "@nestjs/common";
import { SessionError } from "../sessions/session-error.ts";
import { stopProcessGroup } from "./stop-process-group.ts";
import type { CommandLine } from "../config/command-line.ts";
import type { Environment } from "../config/environment-variable.ts";
import type { Session, SessionOpening } from "@open-qa-stack/shared/sessions";
import type { RunFolder } from "./run-folder.ts";

/** Most lines of the error output of the command the log repeats. */
const MAX_ERROR_LINES = 10;

/**
 * Starts runs of the `oqas` command line on a test repository, one for each session opened from the instance.
 *
 * @remarks
 * The command is started without a shell, with `--repository`, `--brief` and, when one is named,
 * `--environment`, in the environment it is given: that of the API without its secrets. It is detached, at
 * the head of its own process group: the run goes on when the request is answered, and when the API stops.
 * Its error output goes to a temporary file, removed once the opening is settled. When the command stops
 * early, that output is logged and never answered: it may name files and addresses of the machine.
 *
 * A run is known to have started when the repository holds a journal it did not hold before. One session is
 * therefore opened at a time, and none while a run is going: two runs must not work in the same repository
 * at once. A run someone starts by hand at that very moment would be taken for the session.
 */
export class RunLauncher {
  readonly #folder: RunFolder;
  readonly #repository: string;
  readonly #command: CommandLine;
  readonly #environment: Environment;
  readonly #pollMs: number;
  readonly #waitMs: number;
  readonly #logger = new Logger("Solo");
  #opening = false;

  /**
   * @param folder - The test repository, as it is read.
   * @param repository - Its root, absolute.
   * @param command - The program that starts `oqas`, then its arguments.
   * @param environment - The environment the command is started in.
   * @param pollMs - How often the journal of the new run is looked for, in milliseconds.
   * @param waitMs - How long it is looked for, in milliseconds.
   */
  constructor(folder: RunFolder, repository: string, command: CommandLine, environment: Environment, pollMs: number, waitMs: number) {
    this.#folder = folder;
    this.#repository = repository;
    this.#command = command;
    this.#environment = environment;
    this.#pollMs = pollMs;
    this.#waitMs = waitMs;
  }

  /**
   * Starts a run.
   *
   * @param opening - What to test, and where.
   * @returns The session of the run, once its journal exists.
   * @throws {@link SessionError} `session_running` while a session is being opened or a run of the repository
   * is going, `not_opened` when the command cannot be started or stops before the run starts, and
   * `opening_timed_out` when the run has not started in time; the command and what it started are then stopped.
   */
  async open(opening: SessionOpening): Promise<Session> {
    if (this.#opening) throw new SessionError("session_running", "A session is being opened: wait for its end before opening another.");
    this.#opening = true;
    try {
      const sessions = await this.#folder.sessions();
      const running = sessions.find(({ state }) => state === "running");
      if (running !== undefined) {
        throw new SessionError("session_running", `The session ${running.id} is running: wait for its end before opening another.`);
      }
      return await this.#start(opening, new Set(sessions.map(({ id }) => id)));
    } finally {
      this.#opening = false;
    }
  }

  /**
   * Starts the command, detached, its error output in a file, in a copy of its environment, which starting a
   * program may add to; what cannot be given to a command at all is refused.
   */
  #spawn(program: string, options: readonly string[], errors: number): ChildProcess {
    try {
      return spawn(program, options, { detached: true, stdio: ["ignore", "ignore", errors], env: { ...this.#environment } });
    } catch (error) {
      this.#logger.warn(`The command that opens a session could not be started: ${String(error)}`);
      throw new SessionError("not_opened", "The command that opens a session could not be started; the log of the instance says why.");
    }
  }

  async #start({ request, environment }: SessionOpening, known: ReadonlySet<string>): Promise<Session> {
    const [program, ...leading] = this.#command;
    const said = await mkdtemp(join(tmpdir(), "oqas-session-"));
    const log = join(said, "errors.log");
    const errors = await open(log, "w");
    try {
      const options = ["--repository", this.#repository, "--brief", request, ...(environment === undefined ? [] : ["--environment", environment])];
      const child = this.#spawn(program, [...leading, ...options], errors.fd);
      let stopped: string | undefined;
      child.once("error", (error) => {
        stopped = error.message;
      });
      child.once("exit", () => {
        stopped ??= "";
      });
      child.unref();
      for (let waited = 0; waited <= this.#waitMs; waited += this.#pollMs) {
        // Read before the runs are listed: a command that wrote its journal and stopped while they were
        // listed is only refused once they were listed again.
        const seenStopped = stopped;
        const started = (await this.#folder.runs()).find(({ id }) => !known.has(id));
        if (started !== undefined) return await this.#folder.describe(started);
        if (seenStopped !== undefined) {
          const lines = (await readFile(log, "utf8")).split("\n").filter((line) => line.trim() !== "");
          const why = [seenStopped, ...lines.slice(-MAX_ERROR_LINES)].filter((line) => line !== "").join("\n");
          this.#logger.warn(`The command stopped before opening a session${why === "" ? ", without a word." : `:\n${why}`}`);
          throw new SessionError("not_opened", "The command stopped before opening a session; the log of the instance has its output.");
        }
        await pause(this.#pollMs);
      }
      stopProcessGroup(child.pid);
      throw new SessionError("opening_timed_out", `The session did not start within ${this.#waitMs} ms; the command was stopped.`);
    } finally {
      await errors.close();
      await rm(said, { recursive: true, force: true });
    }
  }
}
