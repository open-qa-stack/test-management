/** The paces of a process on the sessions of a store that other processes reach too. */
export interface SessionsPace {
  /**
   * How often a process that hosts sessions beats, in milliseconds. At each beat it tells the store it is
   * alive, reads what other processes left it there — a message for a session it runs, an interruption asked
   * for one — and sees to the sessions a silent host left. It is the longest a message or an interruption
   * another process sent waits before the host learns of it.
   */
  readonly beatMs: number;
  /**
   * How long without a beat tells that a host died, in milliseconds: long enough for a host that is only
   * slow — a machine under load, a write that waits for another process — never to be taken for one.
   */
  readonly silentAfterMs: number;
  /**
   * How often the events of a session another process hosts are read again from the store by whoever follows
   * it, in milliseconds: no notification crosses processes.
   */
  readonly followMs: number;
}

/** The paces of a process unless its host sets others: a beat a second, a host silent after fifteen, and a followed session read twice a second. */
export const DEFAULT_PACE: SessionsPace = { beatMs: 1000, silentAfterMs: 15_000, followMs: 500 };
