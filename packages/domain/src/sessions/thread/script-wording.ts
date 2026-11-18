import type { SessionPhase } from "../session-event.ts";

/**
 * The words of a presentation for what a thread tells: the folding of the events into steps is the same in a
 * browser and in a terminal, and each says it in its language.
 */
export interface ScriptWording {
  /**
   * @param phase - A phase of the work; a later version may name one this presentation does not know.
   * @returns How the start of the phase reads.
   */
  readonly phase: (phase: SessionPhase) => string;
  /**
   * @param tool - The name of a tool.
   * @param args - The arguments of its call.
   * @returns What the call did, as a sentence.
   */
  readonly tool: (tool: string, args: unknown) => string;
  /** The title of a plan the harness accepted. */
  readonly planAccepted: string;
  /** What the thread notes when the session stopped without ending. */
  readonly interrupted: string;
  /**
   * @param tests - How many tests the session ran.
   * @returns The title of their verdicts.
   */
  readonly verdicts: (tests: number) => string;
  /**
   * @param scenarios - How many scenarios the harness closed, when no test ran.
   * @returns The title of what they came to.
   */
  readonly closed: (scenarios: number) => string;
  /**
   * @param day - The day the session was opened, as `2026-11-13`.
   * @param time - The time it was opened, as `14:44:06`, in universal time.
   * @returns The title of a session nobody asked anything in.
   */
  readonly opened: (day: string, time: string) => string;
}
