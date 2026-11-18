import { sessionResultOf, type RunState } from "@open-qa-stack/domain";
import type { SessionResult } from "@open-qa-stack/domain/sessions";
import type { RunStore, StoredState } from "../ports/run-store.ts";

/**
 * The state of a run as its session keeps it: what the run came to is the result of the session, and nothing
 * else of the state is kept.
 *
 * @remarks
 * The run writes its state in its summary, before its last entries: the state is held here, and the host
 * ends the session with its result once the run returned. An instance resumes no run yet: it keeps no state
 * to resume from, and says so to a run that asks for one.
 */
export class SessionRunStore implements RunStore {
  readonly #session: string;
  #state: RunState | undefined;

  /** @param session - The identifier of the session. */
  constructor(session: string) {
    this.#session = session;
  }

  /** @returns The result of the session, once its run wrote its state; `undefined` for a run that stopped before its summary. */
  get result(): SessionResult | undefined {
    return this.#state === undefined ? undefined : sessionResultOf({ ...this.#state });
  }

  /** @returns What names the state of the run: its session, which is read with its result. */
  location(): string {
    return `sessions/${this.#session}`;
  }

  /** @throws Always: an instance keeps no state a run could resume from. */
  async read(): Promise<StoredState> {
    throw new Error("A session of an instance cannot resume a run: an instance keeps the result of a run, not the state to resume it from.");
  }

  /** @returns Nothing: an instance keeps the state of no run. */
  async readAll(): Promise<readonly unknown[]> {
    return [];
  }

  /** {@inheritDoc RunStore.write} */
  async write(_run: unknown, state: RunState): Promise<void> {
    this.#state = state;
  }
}
