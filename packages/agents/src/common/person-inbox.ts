import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import type { PersonMessage } from "./person-message.ts";

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
export class PersonInbox {
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

  /**
   * The messages no session received yet.
   *
   * @returns Them, in the order they were written, those written since the last reading included.
   */
  public pending(): readonly PersonMessage[] {
    for (const line of this.grown()) {
      this.lines += 1;
      const text = textOf(line);
      if (text !== undefined) this.waiting.push({ number: this.lines, text });
    }
    return [...this.waiting];
  }

  /**
   * The messages a session received already, since the run started.
   *
   * @returns Them, in the order they were written.
   */
  public heard(): readonly PersonMessage[] {
    return [...this.received];
  }

  /**
   * Marks messages as received by a session: they are pending no more, and are heard from then on.
   *
   * @param through - The number of the last message received.
   */
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

/** What a line of the inbox says, when it is a message. */
function textOf(line: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const text = typeof value === "object" && value !== null ? (value as { readonly text?: unknown }).text : undefined;
  return typeof text === "string" && text.trim() !== "" ? text : undefined;
}
