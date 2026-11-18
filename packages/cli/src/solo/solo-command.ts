import { resolve } from "node:path";
import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import { playwrightVersion } from "@open-qa-stack/tools";
import type { Session } from "@open-qa-stack/domain/sessions";
import type { Sessions } from "@open-qa-stack/engine";
import { parseArguments, USAGE, type Arguments, type Command } from "./arguments.ts";
import { eventLine, ofTheAgents } from "./event-line.ts";
import { failureOf } from "./failure.ts";
import { followSession } from "./follow-session.ts";
import { Interruptions } from "./interruptions.ts";
import { openOperations } from "./operations.ts";
import { RepositoryInit } from "./repository-init.ts";
import { servedConsole } from "./served-console.ts";
import { exitCodeOf } from "./session-exit.ts";
import { listedLine, summaryLines } from "./session-lines.ts";
import { referredSession } from "./session-reference.ts";
import { ThreadOutput } from "./thread-output.ts";
import { UsageError } from "./usage-error.ts";
import type { CommandIo } from "./command-io.ts";

/** What a command on sessions is given: the operations, what it was asked, and where it writes. */
interface Asked<Name extends Command["name"]> {
  readonly sessions: Sessions;
  readonly command: Extract<Command, { name: Name }>;
  readonly options: Arguments;
  readonly io: CommandIo;
}

/** What `oqas` without a command is told where it cannot open its conversation. */
const NO_TERMINAL = "oqas opens its conversation in a terminal, and this is not one: say what to test with --brief, or name a command; see oqas --help.";

/**
 * Runs `oqas` with its arguments: prints the usage, refuses a wrong argument, initialises the test
 * repository, or says one operation on the sessions of the test repository in the terminal.
 *
 * @remarks
 * The command is a presentation of the operations on sessions of the engine, on the database of the instance:
 * what it opens, a server on the same database shows, and what a server opens, it reads, follows, speaks to
 * and interrupts. Without a command, in a terminal, it opens a conversation, where the sessions are opened,
 * followed, spoken to and stopped. With `--brief` it opens a session, which it runs in its own process, follows it to its end
 * and exits with the code of its run. With `--ui` it serves the console, and runs the sessions opened in it
 * until it is stopped. The other commands host nothing: they read the database or post to it, and the process
 * that runs the session does the rest.
 *
 * @param argv - The arguments, without the program.
 * @param io - The environment, the folder and the outputs.
 * @returns The exit code: that of the session followed, `0` for a command that did what it was asked, `3`
 * when it is refused, `5` when it fails, which goes to the error output.
 */
export async function soloCommand(argv: readonly string[], io: CommandIo): Promise<ExitCodeValue> {
  const parsed = parseArguments(argv);
  if (!parsed.ok) {
    io.stderr.write(`${parsed.error}\n`);
    return ExitCode.configuration;
  }
  const options = parsed.arguments;
  const { command } = options;
  if (command.name === "help") {
    io.stdout.write(USAGE);
    return ExitCode.passed;
  }
  const repository = resolve(io.cwd, options.repository ?? ".");
  if (command.name === "init")
    return new RepositoryInit({
      repositoryRoot: repository,
      playwrightVersion: playwrightVersion(),
      write: (line) => io.stderr.write(line),
      print: (line) => io.stdout.write(line),
    }).run();
  try {
    return await onSessions(command, options, repository, io);
  } catch (error) {
    const { kind, message } = failureOf(error);
    io.stderr.write(kind === "unexpected" ? `oqas stopped on an unexpected error: ${message}\n` : `${message}\n`);
    return kind === "refused" ? ExitCode.configuration : ExitCode.interrupted;
  }
}

/** Runs a command on the sessions of a test repository, with the operations opened for it and let go of afterwards. */
async function onSessions(command: Exclude<Command, { name: "help" | "init" }>, options: Arguments, repository: string, io: CommandIo): Promise<ExitCodeValue> {
  if (command.name === "run") return opened({ command, options, io }, repository);
  if (command.name === "ui") return servedConsole(command, repository, io);
  if (command.name === "converse") {
    if (io.terminal === undefined) throw new UsageError(NO_TERMINAL);
    // The conversation and what draws it are loaded here and nowhere else, so that no other command pays for them.
    const { converse } = await import("./conversation/converse.ts");
    return converse({ repository, terminal: io.terminal, io, ...(command.environment === undefined ? {} : { environment: command.environment }) });
  }
  const { sessions, close } = await openOperations(io, repository, false);
  try {
    switch (command.name) {
      case "sessions":
        return await listed({ sessions, command, options, io });
      case "show":
        return await shown({ sessions, command, options, io });
      case "attach":
        return await attached({ sessions, command, options, io });
      case "say":
        return await said({ sessions, command, options, io });
      case "stop":
        return await stopped({ sessions, command, options, io });
    }
  } finally {
    await close();
  }
}

/** Writes a line to the standard output, as a text or as the JSON of a value. */
function print({ options, io }: Pick<Asked<Command["name"]>, "options" | "io">, text: string, value: unknown): void {
  io.stdout.write(`${options.output === "json" ? JSON.stringify(value) : text}\n`);
}

/** The session a command names, whatever it gave of its identifier. */
async function named(sessions: Sessions, reference: string): Promise<Session> {
  return referredSession(await sessions.sessions(), reference);
}

/**
 * Follows a session to its end, then says what it came to.
 *
 * @returns The code of the run of the session.
 */
async function followed({ sessions, options, io }: Pick<Asked<Command["name"]>, "sessions" | "options" | "io">, id: string): Promise<ExitCodeValue> {
  const json = options.output === "json";
  // A thread a person reads goes where the journal of a run always went, and leaves the standard output to the summary.
  const thread = new ThreadOutput(json ? io.stdout : io.stderr, options.output, options.follow);
  await followSession(sessions, id, thread);
  const session = await sessions.session(id);
  if (!json) for (const line of summaryLines(session)) io.stdout.write(`${line}\n`);
  return exitCodeOf(session, thread.lastPhase);
}

/**
 * `oqas --brief`: opens a session, runs it in this process and follows it to its end.
 *
 * @remarks
 * The person stops it with Ctrl-C: the first asks the session to stop, as `oqas stop` does, and the command
 * goes on to the end of the session, which comes soon; a second one leaves at once, without waiting for it.
 */
async function opened({ command, options, io }: Omit<Asked<"run">, "sessions">, repository: string): Promise<ExitCodeValue> {
  const { sessions, close } = await openOperations(io, repository, true);
  let withinMs: number | undefined;
  try {
    const { brief: request, environment } = command;
    const { id } = await sessions.open({ request, ...(environment === undefined ? {} : { environment }) });
    io.stderr.write(`Session ${id}\n`);
    const interruptions = new Interruptions(io, () => sessions.interrupt(id), {
      asked: "The session is asked to stop, and ends soon.",
      failed: "The session was not asked to stop",
    });
    const ended = followed({ sessions, options, io }, id);
    const left = interruptions.leftAtOnce.then(() => {
      // Nothing is waited for any more: neither the session, nor what its following still raises.
      withinMs = 0;
      void ended.catch(() => undefined);
      return ExitCode.interrupted;
    });
    return await Promise.race([ended, left]).finally(() => interruptions.end());
  } finally {
    await close(withinMs);
  }
}

/** `oqas sessions`: lists the sessions, the latest first. */
async function listed(asked: Asked<"sessions">): Promise<ExitCodeValue> {
  for (const session of await asked.sessions.sessions()) print(asked, listedLine(session), session);
  return ExitCode.passed;
}

/** `oqas show`: prints a session and its thread so far; as JSON Lines, its thread alone, an event a line. */
async function shown({ sessions, command, options, io }: Asked<"show">): Promise<ExitCodeValue> {
  const session = await named(sessions, command.session);
  const events = await sessions.thread(session.id);
  if (options.output === "json") for (const event of events) io.stdout.write(`${JSON.stringify(event)}\n`);
  else {
    const told = events.filter((event) => options.follow || !ofTheAgents(event)).map(eventLine);
    for (const line of [...summaryLines(session), ...told]) io.stdout.write(`${line}\n`);
  }
  return ExitCode.passed;
}

/** `oqas attach`: follows a session another process runs, or one that ended, as the command that opened it does. */
async function attached({ sessions, command, options, io }: Asked<"attach">): Promise<ExitCodeValue> {
  const { id } = await named(sessions, command.session);
  return followed({ sessions, options, io }, id);
}

/** `oqas say`: says something to a session that goes on; the process that runs it hands it to the agent at work. */
async function said(asked: Asked<"say">): Promise<ExitCodeValue> {
  const { sessions, command } = asked;
  const { id } = await named(sessions, command.session);
  const receipt = await sessions.say(id, { text: command.text });
  print(asked, `Message ${receipt.number} is taken by the session ${id}.`, receipt);
  return ExitCode.passed;
}

/** `oqas stop`: interrupts a session that goes on; one another process runs is interrupted by that process, soon. */
async function stopped(asked: Asked<"stop">): Promise<ExitCodeValue> {
  const { sessions, command } = asked;
  const { id } = await named(sessions, command.session);
  await sessions.interrupt(id);
  const session = await sessions.session(id);
  const interrupted = `The session ${id} is interrupted.`;
  print(asked, session.state === "running" ? `The session ${id} is asked to stop: the process that runs it interrupts it.` : interrupted, session);
  return ExitCode.passed;
}
