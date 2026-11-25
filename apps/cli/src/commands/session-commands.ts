import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import type { Session } from "@open-qa-stack/domain/sessions";
import type { Sessions } from "@open-qa-stack/engine";
import { eventLine, ofTheAgents } from "../output/event-line.ts";
import { listedLine, summaryLines } from "../output/session-lines.ts";
import { referredSession } from "../sessions/session-reference.ts";
import type { Asked } from "./asked.ts";
import { print } from "./print.ts";

/** The session a command names, whatever it gave of its identifier. */
export async function named(sessions: Sessions, reference: string): Promise<Session> {
  return referredSession(await sessions.sessions(), reference);
}

/** `oqas sessions`: lists the sessions, the latest first. */
export async function listed(asked: Asked<"sessions">): Promise<ExitCodeValue> {
  for (const session of await asked.sessions.sessions()) print(asked, listedLine(session), session);
  return ExitCode.passed;
}

/** `oqas show`: prints a session and its thread so far; as JSON Lines, its thread alone, an event a line. */
export async function shown({ sessions, command, options, io }: Asked<"show">): Promise<ExitCodeValue> {
  const session = await named(sessions, command.session);
  const events = await sessions.thread(session.id);
  if (options.output === "json") for (const event of events) io.stdout.write(`${JSON.stringify(event)}\n`);
  else {
    const told = events.filter((event) => options.follow || !ofTheAgents(event)).map(eventLine);
    for (const line of [...summaryLines(session), ...told]) io.stdout.write(`${line}\n`);
  }
  return ExitCode.passed;
}

/** `oqas stop`: interrupts a session that goes on; one another process runs is interrupted by that process, soon. */
export async function stopped(asked: Asked<"stop">): Promise<ExitCodeValue> {
  const { sessions, command } = asked;
  const { id } = await named(sessions, command.session);
  await sessions.interrupt(id);
  const session = await sessions.session(id);
  const interrupted = `The session ${id} is interrupted.`;
  print(asked, session.state === "running" ? `The session ${id} is asked to stop: the process that runs it interrupts it.` : interrupted, session);
  return ExitCode.passed;
}
