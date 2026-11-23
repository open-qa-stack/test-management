import { resolve } from "node:path";
import { ExitCode, type ExitCodeValue } from "@open-qa-stack/domain";
import { hasEnded } from "@open-qa-stack/domain/sessions";
import type { Sessions } from "@open-qa-stack/engine";
import { parseArguments, USAGE, type Arguments, type Command } from "./arguments.ts";
import { followSession } from "./follow-session.ts";
import { Interruptions } from "./interruptions.ts";
import { caught, named, print, runPrinting, type Asked } from "./operation-commands.ts";
import { isConfigured, openOperations, type Operations } from "./operations.ts";
import { servedConsole } from "./served-console.ts";
import { exitCodeOf } from "./session-exit.ts";
import { summaryLines } from "./session-lines.ts";
import { ThreadOutput } from "./thread-output.ts";
import { UsageError } from "./usage-error.ts";
import type { CommandIo } from "./command-io.ts";

/** What `oqas model` alone is told where it cannot ask anything. */
const SETUP_TERMINAL =
  "oqas model alone sets the connection step by step in a terminal, and this is not one: give status, or set with its options; see oqas --help.";

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
 * and exits with the code of its run; `say` does the same with the new turn of a session that ended, which it resumes. With `--ui` it serves the console, and runs the sessions opened in it
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
  return caught(() => onSessions(command, options, repository, io), io.stderr);
}

/** Runs a command on the sessions or the configuration of a test repository, with the operations opened for it and let go of afterwards. */
async function onSessions(command: Exclude<Command, { name: "help" }>, options: Arguments, repository: string, io: CommandIo): Promise<ExitCodeValue> {
  if (command.name === "run") return opened({ command, options, io }, repository);
  if (command.name === "say") return said({ command, options, io }, repository);
  if (command.name === "remap") return remapped({ command, options, io }, repository);
  if (command.name === "ui") return servedConsole(command, repository, io);
  if (command.name === "converse") {
    if (io.terminal === undefined) throw new UsageError(NO_TERMINAL);
    // A folder never configured is set up step by step first, as the console does; the conversation opens once it is.
    if (!(await isConfigured(io, repository))) {
      const { setupProject } = await import("./conversation/project-setup/setup-project.ts");
      if (!(await setupProject(repository, io.terminal, io))) return ExitCode.interrupted;
    }
    // The conversation and what draws it are loaded here and nowhere else, so that no other command pays for them.
    const { converse } = await import("./conversation/converse.ts");
    return converse({ repository, terminal: io.terminal, io, ...(command.environment === undefined ? {} : { environment: command.environment }) });
  }
  if (command.name === "attach") return withOperations(io, repository, ({ sessions }) => attached({ sessions, command, options, io }));
  if (command.name === "model" && command.action === "setup") return withOperations(io, repository, (operations) => setUp(operations, io));
  // A launch runs its tests in this process, as a session opened here runs; the project is read from the repository, as a host reads it.
  return withOperations(
    io,
    repository,
    (operations) => runPrinting(operations, repository, command, options, io),
    command.name === "launch" || command.name === "project" || (command.name === "campaigns" && command.action === "launch"),
  );
}

/** Runs something on the operations of a test repository, opened for it and let go of afterwards; hosting what it launches when it does. */
async function withOperations(
  io: CommandIo,
  repository: string,
  run: (operations: Operations) => Promise<ExitCodeValue>,
  hosts = false,
): Promise<ExitCodeValue> {
  const operations = await openOperations(io, repository, hosts);
  try {
    return await run(operations);
  } finally {
    await operations.close();
  }
}

/** `oqas model` alone: sets the connection to the model step by step, in a terminal. */
async function setUp(operations: Pick<Operations, "configuration" | "secrets">, io: CommandIo): Promise<ExitCodeValue> {
  if (io.terminal === undefined) throw new UsageError(SETUP_TERMINAL);
  // The setting and what draws it are loaded here and nowhere else, as the conversation is.
  const { setupModel } = await import("./conversation/model-setup/setup-command.ts");
  return setupModel(operations, io.terminal, io);
}

/**
 * Follows a session to its end, then says what it came to.
 *
 * @param after - The rank of the last event of the session not to print; 0 for every event.
 * @returns The code of the run of the session.
 */
async function followed(
  { sessions, options, io }: Pick<Asked<Command["name"]>, "sessions" | "options" | "io">,
  id: string,
  after: number,
): Promise<ExitCodeValue> {
  const json = options.output === "json";
  // A thread a person reads goes where the journal of a run always went, and leaves the standard output to the summary.
  const thread = new ThreadOutput(json ? io.stdout : io.stderr, options.output, options.follow);
  await followSession(sessions, id, thread, after);
  const session = await sessions.session(id);
  if (!json) for (const line of summaryLines(session)) io.stdout.write(`${line}\n`);
  return exitCodeOf(session, thread.lastPhase);
}

/** A session a command hosts, from the event after which its thread is printed. */
interface Hosted {
  readonly id: string;
  /** The rank of the last event of the session not to print. */
  readonly after: number;
}

/**
 * `oqas --brief`: opens a session, runs it in this process and follows it to its end.
 */
function opened({ command, options, io }: Omit<Asked<"run">, "sessions">, repository: string): Promise<ExitCodeValue> {
  return hosting({ options, io }, repository, async (sessions) => {
    const { brief: request, environment } = command;
    const { id } = await sessions.open({ request, ...(environment === undefined ? {} : { environment }) });
    return { id, after: 0 };
  });
}

/**
 * Runs in this process the session a command opens or resumes, and follows it to its end.
 *
 * @remarks
 * The person stops it with Ctrl-C: the first asks the session to stop, as `oqas stop` does, and the command
 * goes on to the end of the session, which comes soon; a second one leaves at once, without waiting for it.
 *
 * @param begin - Opens or resumes the session, on the operations of the command; gives no session when there is none to run.
 * @returns The code of the run of the session; `0` when there was none to run.
 */
async function hosting(
  { options, io }: Pick<Asked<Command["name"]>, "options" | "io">,
  repository: string,
  begin: (sessions: Sessions) => Promise<Hosted | undefined>,
): Promise<ExitCodeValue> {
  const { sessions, close } = await openOperations(io, repository, true);
  let withinMs: number | undefined;
  try {
    const hosted = await begin(sessions);
    if (hosted === undefined) return ExitCode.passed;
    const { id, after } = hosted;
    io.stderr.write(`Session ${id}\n`);
    const interruptions = new Interruptions(io, () => sessions.interrupt(id), {
      asked: "The session is asked to stop, and ends soon.",
      failed: "The session was not asked to stop",
    });
    const ended = followed({ sessions, options, io }, id, after);
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

/**
 * `oqas knowledge remap`: maps the knowledge again, the source named or every source, in a session this command runs,
 * as `--brief` runs one it opens, and follows to its end; when a session maps the knowledge already, says which, and
 * opens none.
 */
function remapped({ command, options, io }: Omit<Asked<"remap">, "sessions">, repository: string): Promise<ExitCodeValue> {
  return hosting({ options, io }, repository, async (sessions) => {
    const remap = await sessions.remap(command.source);
    if (remap.state === "unknown")
      throw new UsageError(`The configuration in force declares no knowledge source ${remap.source} to map; oqas knowledge mapping lists them.`);
    if (remap.state === "busy") {
      print({ options, io }, `A session maps the knowledge already: ${remap.session.id}. oqas attach ${remap.session.id} follows it.`, remap);
      return undefined;
    }
    return { id: remap.session.id, after: 0 };
  });
}

/** `oqas attach`: follows a session another process runs, or one that ended, as the command that opened it does. */
async function attached({ sessions, command, options, io }: Asked<"attach">): Promise<ExitCodeValue> {
  const { id } = await named(sessions, command.session);
  return followed({ sessions, options, io }, id, 0);
}

/**
 * `oqas say`: says something to a session. One that goes on takes it as a message, which the process that runs it
 * hands to the agent at work. One that ended is resumed with it: this command runs its new turn, as `--brief`
 * runs a session it opens, and follows it from the message on.
 */
function said({ command, options, io }: Omit<Asked<"say">, "sessions">, repository: string): Promise<ExitCodeValue> {
  return hosting({ options, io }, repository, async (sessions) => {
    const { id, state } = await named(sessions, command.session);
    const text = { text: command.text };
    if (hasEnded(state)) {
      // The ranks of the events go from 1 without a gap: the thread of the turns before ends at its length.
      const after = (await sessions.thread(id)).length;
      await sessions.resume(id, text);
      return { id, after };
    }
    const receipt = await sessions.say(id, text);
    print({ options, io }, `Message ${receipt.number} is taken by the session ${id}.`, receipt);
    return undefined;
  });
}
