import { journalLine, RunThread, traceLine, type RunLine } from "@open-qa-stack/domain";
import type { Session, SessionResult } from "@open-qa-stack/domain/sessions";
import { Run } from "../run/run.ts";
import { liveRuntime } from "../runtime/live-runtime.ts";
import { SessionJournal } from "./session-journal.ts";
import { SessionRunStore } from "./session-run-store.ts";
import { sessionTurn } from "./session-turn.ts";
import { SessionWriter } from "./session-writer.ts";
import type { SessionInbox } from "./session-inbox.ts";
import type { SessionsHost } from "./sessions-host.ts";

/** What an execution is run with, besides what its host gives every session. */
export interface ExecutionOptions {
  /** The session, which the store just started. */
  readonly session: Session;
  /** Absolute path of the test repository the run works in. */
  readonly repository: string;
  /** The inbox of the execution: the messages dropped in it reach the agents of the run. */
  readonly inbox: SessionInbox;
  /** What asks the execution to stop. */
  readonly stop: AbortController;
  /** Aborted by a host that stops without waiting for the execution any longer: what the store does not take is then given up. */
  readonly abandoned: AbortSignal;
  /** Called each time the store took what the execution told: the session gained events. */
  readonly wrote: () => void;
}

/**
 * One execution of a session: the run of the engine, plugged into the store of the sessions, from the
 * messages the session was sent while it waited to the end that is written to it.
 *
 * @remarks
 * What the turn of the session asks is the brief of the run, in the environment the session names: the request
 * of a session that opens, and, for one a person resumed, what they ask now with what the turns before did, on
 * the branch they wrote their tests on, as `sessionTurn` tells it. The entries of the journal and the lines of
 * the traces become the events of the session, as `RunThread` of the domain writes them for every host, and are
 * written in the order the run told them. The inbox of the run is the inbox of
 * the execution. The state the run writes at its end gives the result the session is completed with; a run
 * that stopped before it wrote one — on its configuration or on a prerequisite — leaves its session
 * interrupted, and so does a run that was asked to stop, whatever it wrote.
 *
 * An execution never fails. What the run raises — a port that refuses, an error nothing expected — and a
 * reading of the store that fails are told to the session as a refusal that says why, and the session is
 * interrupted: nothing is left running for a failure.
 */
export class SessionExecution {
  readonly #host: SessionsHost;
  readonly #options: ExecutionOptions;

  /**
   * @param host - What the host of the sessions gives every one of them.
   * @param options - The session, and what its execution is run with.
   */
  constructor(host: SessionsHost, options: ExecutionOptions) {
    this.#host = host;
    this.#options = options;
  }

  /**
   * Runs the session to its end, and tells it to the store.
   *
   * @returns Once the end of the session is written, or the session takes nothing more.
   */
  async run(): Promise<void> {
    const { store, env, logger, runner, writerPace, now = () => new Date() } = this.#host;
    const { session, repository, inbox, stop, abandoned, wrote } = this.#options;
    const { id, request, environment } = session;
    const writer = new SessionWriter(store, id, logger, { wrote, lost: () => stop.abort() }, abandoned, writerPace);
    const thread = new RunThread();
    const tell = (line: RunLine | undefined): void => writer.tell(line === undefined ? [] : thread.add(line));
    // A line goes through the text a run writes of it, which is what every host reads a run from.
    const journal = new SessionJournal(id, (entry) => tell(journalLine(JSON.stringify(entry))));
    const kept = new SessionRunStore();
    let result: SessionResult | undefined;
    let failure: string | undefined;
    try {
      // What the person said while the session waited is there before the first agent works.
      for (const message of await store.pendingMessages(id)) inbox.drop(message);
      const { brief, branch } = sessionTurn(request, await store.eventsAfter(id, 0));
      await new Run({
        repositoryRoot: repository,
        configuration: this.#host.configuration,
        documents: this.#host.documents,
        ...(brief === undefined ? {} : { brief }),
        ...(branch === undefined ? {} : { branch }),
        ...(environment === undefined ? {} : { environment }),
        env,
        journal,
        follow: (line) => tell(traceLine(JSON.stringify(line))),
        openInbox: () => inbox,
        store: kept,
        openRuntime: this.#host.openRuntime ?? ((config) => liveRuntime(config, env)),
        ...(runner === undefined ? {} : { runner }),
        now,
        stop: stop.signal,
      }).run();
      result = kept.result;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    // A run the configuration or the prerequisites stopped never had its journal kept: what it wrote is all that says why.
    journal.release();
    if (failure !== undefined) {
      logger.warn(`The session ${id} stopped on a failure: ${failure}`);
      writer.tell([{ at: now().toISOString(), type: "refusal", phase: "summary", text: `The session stopped on a failure, and is interrupted: ${failure}` }]);
    }
    await writer.end(stop.signal.aborted ? undefined : result);
  }
}
