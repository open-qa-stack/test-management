import type { SessionInbox } from "./session-inbox.ts";

/** The execution of a session that runs in this process. */
export interface RunningExecution {
  /** The inbox the agents of the execution read at each of their steps: a message dropped here reaches them. */
  readonly inbox: SessionInbox;
  /** What asks the execution to stop: once aborted, its agents refuse to go on, and the execution ends by itself. */
  readonly stop: AbortController;
  /** Settles once the execution ended and its session has its end written; it never rejects. */
  readonly ended: Promise<void>;
}

/**
 * The registry of the executions that run in this process, one per session: how an operation that names a
 * session finds the execution of that session again.
 *
 * @remarks
 * The registry is the memory of the process, and nothing else: it holds no state of a session, which the
 * store keeps, and decides nothing. An execution is added before its first step and removed after its last,
 * by whoever started it; in between, saying something to the session drops the message in `inbox`,
 * interrupting it aborts `stop`, and whoever must wait for it — to start the next session, to shut down —
 * awaits `ended`. A session that has no entry is not running here: it waits, it ended, or it does not exist.
 */
export class RunningExecutions {
  readonly #executions = new Map<string, RunningExecution>();

  /**
   * Adds the execution of a session.
   *
   * @param session - The identifier of the session.
   * @param execution - Its execution, which starts.
   * @throws Error when the session already has an execution: a session runs once.
   */
  add(session: string, execution: RunningExecution): void {
    if (this.#executions.has(session)) throw new Error(`The session ${session} is already running.`);
    this.#executions.set(session, execution);
  }

  /**
   * @param session - The identifier of a session.
   * @returns Its execution; `undefined` when the session is not running in this process.
   */
  find(session: string): RunningExecution | undefined {
    return this.#executions.get(session);
  }

  /** @returns Every execution that runs, in the order they were added. */
  all(): readonly RunningExecution[] {
    return [...this.#executions.values()];
  }

  /**
   * Removes the execution of a session, which ended.
   *
   * @param session - The identifier of the session; one that has no execution changes nothing.
   */
  remove(session: string): void {
    this.#executions.delete(session);
  }
}
