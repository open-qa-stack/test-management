import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { inboxMessage, type PersonMessage } from "@open-qa-stack/domain";
import type { Inbox } from "./inbox.ts";

const LINE_END = 0x0a;

/**
 * The inbox of a run: the messages a person sends to its agents while it is going, read from a JSON Lines
 * file anyone may append to.
 *
 * @remarks
 * A line is one message, `{ "at": "<ISO 8601 date>", "text": "<what the person says>" }`, and the messages
 * are numbered from 1 in the order of the lines. Only `text` is read. A line that is not such an object, or
 * whose text is empty, is no message and still takes its number, so that a number always names the same
 * line. The file is read as it grows: no byte is read twice, and a last line without its end waits for it,
 * its writer being in the middle of it. A file that does not exist is an empty inbox. So is one that exists
 * and cannot be read, since a run never stops for its inbox: `unreadable` then says why, for the run to tell.
 *
 * Reading waits for nothing, so that who reads the pending messages and marks them as delivered at once
 * gives each to one session, once. A message delivered is kept: what the person said stands for the rest of
 * the run, and the sessions that open later are told it again.
 */
export class PersonInbox implements Inbox {
  private readonly path: string;
  /** The bytes of the file read so far: whole lines only. */
  private offset = 0;
  /** The lines read so far. */
  private lines = 0;
  private readonly waiting: PersonMessage[] = [];
  /** The messages a session received, in the order they were written. */
  private readonly received: PersonMessage[] = [];
  private failure: string | undefined;

  /** @param path - The file of the inbox; it may not exist yet. */
  public constructor(path: string) {
    this.path = path;
  }

  /**
   * Why the file could not be read, the first time it could not; `undefined` while every reading succeeded
   * or found no file.
   */
  public get unreadable(): string | undefined {
    return this.failure;
  }

  /** {@inheritDoc Inbox.pending} */
  public pending(): readonly PersonMessage[] {
    for (const line of this.grown()) {
      this.lines += 1;
      const message = inboxMessage(line);
      if (message !== undefined) this.waiting.push({ number: this.lines, text: message.text });
    }
    return [...this.waiting];
  }

  /** {@inheritDoc Inbox.heard} */
  public heard(): readonly PersonMessage[] {
    return [...this.received];
  }

  /** {@inheritDoc Inbox.delivered} */
  public delivered(through: number): void {
    this.received.push(...this.waiting.splice(0, this.waiting.filter((message) => message.number <= through).length));
  }

  /** The whole lines the file gained since the last reading; none, the failure kept, when it cannot be read. */
  private grown(): string[] {
    let file: number | undefined;
    try {
      file = openSync(this.path, "r");
      const added = Buffer.alloc(Math.max(0, fstatSync(file).size - this.offset));
      const read = readSync(file, added, 0, added.length, this.offset);
      const whole = added.subarray(0, added.subarray(0, read).lastIndexOf(LINE_END) + 1);
      this.offset += whole.length;
      return whole.toString("utf8").split("\n").slice(0, -1);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.failure ??= (error as Error).message;
      return [];
    } finally {
      if (file !== undefined) closeSync(file);
    }
  }
}
