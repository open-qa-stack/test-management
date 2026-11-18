import { appendFile, readFile } from "node:fs/promises";

/**
 * Appends the messages of a person to the inbox of a run of the command line: the JSON Lines file the run
 * reads while it is going, one message a line, `{ "at": "<ISO 8601 date>", "text": "<what the person says>" }`.
 *
 * @remarks
 * This is the one place where the instance writes to the test repository. The command line numbers the
 * messages by the rank of their lines, from 1, and names a message by that number when it delivers it: the
 * number answered here is the count of the lines of the inbox once the message is appended. Messages are
 * appended one at a time, each as one whole line in one write, so that two messages sent at once never
 * share a line nor a number, and the run never reads half of one.
 */
export class RunInboxWriter {
  readonly #now: () => Date;
  #last: Promise<unknown> = Promise.resolve();

  /** @param now - The clock, which dates each message. */
  constructor(now: () => Date) {
    this.#now = now;
  }

  /**
   * Appends a message to an inbox, which it starts when the run has none yet.
   *
   * @param path - The inbox, absolute, in a folder that exists.
   * @param text - What the person says.
   * @returns The number of the message in the inbox.
   * @throws When the inbox cannot be written or read back; the messages that follow are appended all the same.
   */
  append(path: string, text: string): Promise<number> {
    const turn = this.#last.then(() => this.#write(path, text));
    this.#last = Promise.allSettled([turn]);
    return turn;
  }

  async #write(path: string, text: string): Promise<number> {
    await appendFile(path, `${JSON.stringify({ at: this.#now().toISOString(), text })}\n`);
    return (await readFile(path, "utf8")).split("\n").length - 1;
  }
}
