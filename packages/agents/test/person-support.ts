import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentEvent, AgentRuntime, AgentSession, SessionOptions, TerminalEvent } from "@open-qa-stack/domain";

/** Appends a message of the person to the inbox of a run, as whoever speaks to the run does. */
export function say(inbox: string, text: string): void {
  mkdirSync(dirname(inbox), { recursive: true });
  appendFileSync(inbox, `${JSON.stringify({ at: "2026-11-13T10:00:00.000Z", text })}\n`);
}

export const END: TerminalEvent = { type: "end", counters: { iterations: 1, actions: 0, elapsedMs: 1 } };

/** What the agent does in one turn: it calls the tools of its session, then says how the turn ends. */
export type Turn = (call: (tool: string) => Promise<unknown>) => Promise<TerminalEvent> | TerminalEvent;

/**
 * A runtime that calls no model: its one session plays a turn of the script for each message, and an end
 * once the script is over. It keeps what the session was opened with, each message it was sent, and the
 * result of each call of a tool.
 */
export class TurnsRuntime implements AgentRuntime {
  public opened: SessionOptions | undefined;
  public readonly sent: string[] = [];
  public readonly results: unknown[] = [];
  private readonly turns: Turn[];

  public constructor(turns: readonly Turn[]) {
    this.turns = [...turns];
  }

  public async openSession(options: SessionOptions): Promise<AgentSession> {
    this.opened = options;
    const { sent, results, turns } = this;
    return {
      async *send(message: string): AsyncIterable<AgentEvent> {
        sent.push(message);
        const turn = turns.shift() ?? (() => END);
        yield await turn(async (name) => {
          const result = await options.tools.find((tool) => tool.name === name)!.execute({});
          results.push(result);
          return result;
        });
      },
      close: async () => {},
    };
  }

  public async close(): Promise<void> {}
}
