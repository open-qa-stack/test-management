import type { SessionEvent, SessionResult } from "@open-qa-stack/domain/sessions";

/** What the run of a turn of a session is given: what it is asked, and the branch it goes on with. */
export interface SessionTurn {
  /** The brief of the run: what was asked of the turn, with what the turns before it did when there were some; none for a session nothing was asked of. */
  readonly brief?: string;
  /** The branch the tests of the turns before it are on, which the run goes on with; none for the first turn, or when none wrote a test. */
  readonly branch?: string;
}

/** A list of texts, a line for each, or nothing when there is none. */
function listed(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}\n${lines.map((line) => `- ${line}`).join("\n")}`];
}

/** What the result of a turn says to the agents of the next. */
function resultText(result: SessionResult): string {
  const verdicts = result.tests.map(({ id, verdict, reason }) => `${id}: ${verdict}. ${reason}`.trim());
  const ran = verdicts.length === 0 ? "It ran no test." : `The verdicts of its tests:\n${verdicts.map((line) => `- ${line}`).join("\n")}`;
  return `What the last turn that completed came to: ${result.outcome}. ${ran}`;
}

/**
 * Tells what the run of the turn of a session that starts works on.
 *
 * @remarks
 * A turn is what the person asked — to open the session, or to resume it once it had ended — and the work it
 * opened. The first turn is run on the request alone. A turn that resumes a session is run on what the person
 * asks now, after what the agents need of the turns before: what was asked first and since, the messages that
 * reached an agent, the verdicts of the last turn that completed, and the branch its tests are on. A message no
 * agent received is not repeated here: it waits for the agents of this turn, which are handed it as any other.
 *
 * @param request - What opened the session, when something was asked.
 * @param events - The events of the session so far, in order, the last request among them.
 * @returns The brief of the run, and the branch it goes on with.
 */
export function sessionTurn(request: string | undefined, events: readonly SessionEvent[]): SessionTurn {
  const asked = events.flatMap((event) => (event.type === "user_message" && event.number === undefined ? [event.text] : []));
  const [first, ...since] = asked;
  const now = since.at(-1);
  if (first === undefined || now === undefined) return request === undefined ? {} : { brief: request };
  const delivered = new Set(events.flatMap((event) => (event.type === "message_delivered" ? [event.message] : [])));
  const messages = events.flatMap((event) => (event.type === "user_message" && event.number !== undefined && delivered.has(event.number) ? [event.text] : []));
  const results = events.flatMap((event) => (event.type === "state_changed" && event.result !== undefined ? [event.result] : []));
  const branch = results.findLast((result) => result.branch !== undefined)?.branch;
  const last = results.at(-1);
  const brief = [
    "This session already had turns of work in this test repository, and the person asks for one more.",
    `What the session was asked first:\n${first}`,
    ...listed("What the person asked of the turns since, in order:", since.slice(0, -1)),
    ...listed("What the person said to the agents during those turns:", messages),
    ...(last === undefined ? [] : [resultText(last)]),
    ...(branch === undefined ? [] : [`The tests of the turns before are on the branch ${branch}, which this turn goes on with.`]),
    `What the person asks of this turn:\n${now}`,
  ].join("\n\n");
  return { brief, ...(branch === undefined ? {} : { branch }) };
}
