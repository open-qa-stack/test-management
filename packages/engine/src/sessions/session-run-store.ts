import { sessionResultOf, type RunState } from "@open-qa-stack/domain";
import type { SessionResult } from "@open-qa-stack/domain/sessions";
import type { RunStore } from "../ports/run-store.ts";

/**
 * The state of a run as its session keeps it: what the run came to is the result of the session, and nothing
 * else of the state is kept.
 *
 * @remarks
 * The run writes its state in its summary, before its last entries: the state is held here, and the host
 * ends the session with its result once the run returned.
 */
export class SessionRunStore implements RunStore {
  #state: RunState | undefined;

  /** @returns The result of the session, once its run wrote its state; `undefined` for a run that stopped before its summary. */
  get result(): SessionResult | undefined {
    return this.#state === undefined ? undefined : sessionResultOf({ ...this.#state });
  }

  /** {@inheritDoc RunStore.write} */
  async write(_run: unknown, state: RunState): Promise<void> {
    this.#state = state;
  }
}
