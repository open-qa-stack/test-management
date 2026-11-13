import type { Trace } from "./trace.ts";
import type { PhaseOutcome, TracePhase } from "./trace-line.ts";

/**
 * The phases of a run that concern no source in particular, each traced from its `started` line to its
 * `finished` line.
 *
 * @remarks
 * One phase is open at a time. `close` ends the one still open as `failed`, so that a run that throws leaves
 * no phase without its end.
 */
export class TracedPhases {
  private readonly trace: Trace;
  private open: TracePhase | undefined;
  private last: TracePhase;

  /**
   * @param trace - The trace the phases are written to.
   * @param first - The phase the run starts with, before it is opened.
   */
  public constructor(trace: Trace, first: TracePhase) {
    this.trace = trace;
    this.last = first;
  }

  /** The phase open, or the last one opened: the phase the harness is in. */
  public get current(): TracePhase {
    return this.open ?? this.last;
  }

  /**
   * Opens a phase.
   *
   * @param phase - The phase.
   */
  public start(phase: TracePhase): void {
    this.open = phase;
    this.last = phase;
    this.trace.harness(phase, { type: "started" });
  }

  /**
   * Ends the phase open.
   *
   * @param outcome - How it ended.
   */
  public end(outcome: PhaseOutcome): void {
    if (this.open === undefined) return;
    this.trace.harness(this.open, { type: "finished", outcome });
    this.open = undefined;
  }

  /** Ends the phase still open, if any, as `failed`. */
  public close(): void {
    this.end("failed");
  }
}
