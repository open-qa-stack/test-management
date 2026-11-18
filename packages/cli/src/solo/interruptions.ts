import type { CommandIo } from "./command-io.ts";

/**
 * What a person who presses Ctrl-C asks of a command that follows the session it runs: first that the session
 * stop, which the command then follows to its end, as it comes soon; then, when they ask again, to leave at
 * once, without waiting for it.
 */
export class Interruptions {
  /** Settles once the person asked to leave at once: they asked twice. */
  readonly leftAtOnce: Promise<void>;
  readonly #leave: () => void;

  /**
   * @param io - Where the person is listened to, and told what their request does.
   * @param interrupt - Asks the session to stop.
   */
  constructor(io: Pick<CommandIo, "onInterrupt" | "stderr">, interrupt: () => Promise<void>) {
    // Nobody is listened to, and there is nothing to stop, when the command was given no terminal to listen to.
    let leave = (): void => undefined;
    this.leftAtOnce = new Promise((leaveAtOnce) => {
      let asked = false;
      const listener = (): void => {
        if (asked) return leaveAtOnce();
        asked = true;
        io.stderr.write("The session is asked to stop, and ends soon. Ctrl-C again leaves at once, without waiting for it.\n");
        // A session that ended meanwhile refuses, and a store that does not answer fails: the person is told either way.
        void interrupt().catch((error: unknown) => io.stderr.write(`The session was not asked to stop: ${(error as Error).message}\n`));
      };
      leave = io.onInterrupt?.(listener) ?? leave;
    });
    this.#leave = leave;
  }

  /** Stops listening to the person. */
  end(): void {
    this.#leave();
  }
}
