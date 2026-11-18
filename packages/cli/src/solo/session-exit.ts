import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Session, SessionPhase, SessionResult } from "@open-qa-stack/domain/sessions";

/** The code of a session that was completed, by how it ended. */
const COMPLETED: Readonly<Record<SessionResult["outcome"], ExitCodeValue>> = {
  passed: ExitCode.passed,
  failed: ExitCode.failed,
  inconclusive: ExitCode.unsettled,
  stopped: ExitCode.interrupted,
};

/** The code of a session that stopped in a phase the run never went past: the phase says what was missing. */
const STOPPED_IN: Readonly<Partial<Record<SessionPhase, ExitCodeValue>>> = {
  configuration: ExitCode.configuration,
  prerequisites: ExitCode.prerequisite,
};

/**
 * Gives the code a command that followed a session to its end exits with: the code a run of the engine ends
 * with, read back from what the session tells of it.
 *
 * @remarks
 * A session that is completed says how in its result. One that is interrupted has none: it stopped on its
 * configuration when that is the last phase it started, on a prerequisite when that one is, and otherwise
 * did not go to its end — it was interrupted, its run failed, or it never started.
 *
 * @param session - The session, once it ended.
 * @param lastPhase - The last phase its thread says it started; `undefined` when it started none.
 * @returns The exit code.
 */
export function exitCodeOf(session: Session, lastPhase: SessionPhase | undefined): ExitCodeValue {
  if (session.result !== undefined) return COMPLETED[session.result.outcome] ?? ExitCode.interrupted;
  return (lastPhase === undefined ? undefined : STOPPED_IN[lastPhase]) ?? ExitCode.interrupted;
}
