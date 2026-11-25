import type { CommandIo } from "../commands/command-io.ts";

/** How a command words what a first Ctrl-C does. */
export interface InterruptionWording {
  /** What the person is told when they ask the command to stop. */
  readonly asked: string;
  /** What opens the reason, when what they asked could not be done. */
  readonly failed: string;
}

/**
 * What a person who presses Ctrl-C asks of a command that hosts — the session it follows, or the console it
 * serves: first that it stop, which the command then waits for, as it comes soon; then, when they ask again,
 * to leave at once, without waiting for it.
 */
export class Interruptions {
  /** Settles once the person asked to leave at once: they asked twice. */
  readonly leftAtOnce: Promise<void>;
  readonly #leave: () => void;

  /**
   * @param io - Where the person is listened to, and told what their request does.
   * @param interrupt - Asks what the command hosts to stop.
   * @param wording - How the person is told.
   */
  constructor(io: Pick<CommandIo, "onInterrupt" | "stderr">, interrupt: () => Promise<void>, wording: InterruptionWording) {
    // Nobody is listened to, and there is nothing to stop, when the command was given no terminal to listen to.
    let leave = (): void => undefined;
    this.leftAtOnce = new Promise((leaveAtOnce) => {
      let asked = false;
      const listener = (): void => {
        if (asked) return leaveAtOnce();
        asked = true;
        io.stderr.write(`${wording.asked} Ctrl-C again leaves at once, without waiting for it.\n`);
        // A session that ended meanwhile refuses, and a store that does not answer fails: the person is told either way.
        void interrupt().catch((error: unknown) => io.stderr.write(`${wording.failed}: ${(error as Error).message}\n`));
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
