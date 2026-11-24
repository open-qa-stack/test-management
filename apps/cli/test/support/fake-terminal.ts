import { EventEmitter } from "node:events";
import type { CommandTerminal } from "../../src/index.ts";

/** What is written to a terminal, piece by piece: a control sequence with its arguments and its final letter, another control, or a character. */
const WRITTEN = /\u001B\[([0-9;?]*)[ -/]*([@-~])|\u001B\][^\u0007]*\u0007|\u001B[=>78]|[\s\S]/gu;

/**
 * A terminal a person sits at, for the command that draws a screen in one: the tests type in it, and read
 * what it shows — its scrollback and its screen, as the moves of the cursor and the erasures left them.
 */
export class FakeTerminal implements CommandTerminal {
  readonly stdin: NodeJS.ReadStream;
  readonly stdout: NodeJS.WriteStream;
  #written = "";
  #typed: string | null = null;
  #columns: number;

  /** @param columns - Its width, in columns. */
  constructor(columns = 100) {
    this.#columns = columns;
    const stdout = Object.assign(new EventEmitter(), {
      isTTY: true,
      rows: 40,
      // What draws the screen waits for its last write to be taken before it says the screen is left.
      write: (text: string, taken?: () => void) => {
        this.#written += text;
        taken?.();
        return true;
      },
    });
    Object.defineProperty(stdout, "columns", { get: () => this.#columns });
    this.stdout = stdout as unknown as NodeJS.WriteStream;
    this.stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode: () => undefined,
      setEncoding: () => undefined,
      resume: () => undefined,
      pause: () => undefined,
      ref: () => undefined,
      unref: () => undefined,
      read: () => {
        const typed = this.#typed;
        this.#typed = null;
        return typed;
      },
    }) as unknown as NodeJS.ReadStream;
  }

  /**
   * What the terminal shows, from the top of its scrollback to the bottom of its screen: what was written,
   * once the cursor went up, erased lines and wrote over them, as a screen that is redrawn does. Colours and
   * the other controls are left out.
   */
  get text(): string {
    const lines: string[][] = [[]];
    let row = 0;
    let column = 0;
    for (const [piece, given, control] of this.#written.matchAll(WRITTEN)) {
      const count = Number(given) || 1;
      if (control === "A") row = Math.max(0, row - count);
      else if (control === "G") column = count - 1;
      else if (control === "K") lines[row] = given === "2" ? [] : lines[row]!.slice(0, column);
      else if (control === "J") lines.splice(row + 1);
      else if (piece === "\n") {
        row++;
        column = 0;
        lines[row] ??= [];
      } else if (piece === "\r") column = 0;
      else if (piece.length <= 2 && piece >= " ") {
        const line = lines[row]!;
        while (line.length < column) line.push(" ");
        line[column++] = piece;
      }
    }
    return lines.map((line) => line.join("")).join("\n");
  }

  /** Types keys. */
  type(keys: string): void {
    this.#typed = keys;
    this.stdin.emit("readable");
  }

  /** Resizes the terminal. */
  resize(columns: number): void {
    this.#columns = columns;
    this.stdout.emit("resize");
  }

  /**
   * Waits for the terminal to show a text.
   *
   * @param seen - The text, or what it matches.
   */
  async sees(seen: string | RegExp): Promise<void> {
    const startedAt = Date.now();
    const there = (): boolean => (typeof seen === "string" ? this.text.includes(seen) : seen.test(this.text));
    while (!there()) {
      if (Date.now() - startedAt > 20_000) throw new Error(`Not seen in time: ${String(seen)}\n${this.text.slice(-3000)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Types a line and Enter, once the input shows what was typed. */
  async enter(line: string): Promise<void> {
    this.type(line);
    await this.sees(new RegExp(`\n. ${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\n[^\n]*\n?[^\n]*\n?[^\n]*\n?[^\n]*\n?[^\n]*\n?[^\n]*\n?$`));
    this.type("\r");
  }
}
