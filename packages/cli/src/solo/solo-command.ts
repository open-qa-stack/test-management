import { resolve } from "node:path";
import { configurationText, ExitCode, isStoredDocuments, type ConfigurationView, type ExitCodeValue } from "@open-qa-stack/domain";
import { playwrightVersion } from "@open-qa-stack/tools";
import { hasEnded, type Session } from "@open-qa-stack/domain/sessions";
import type { Configuration, KnowledgeDocuments, KnowledgeSources, Secrets, Sessions } from "@open-qa-stack/engine";
import type { CartographyState } from "@open-qa-stack/domain";
import { parseArguments, USAGE, type Arguments, type Command } from "./arguments.ts";
import { fileLine, revisionLine } from "./configuration-lines.ts";
import { eventLine, ofTheAgents } from "./event-line.ts";
import { failureOf } from "./failure.ts";
import { followSession } from "./follow-session.ts";
import { Interruptions } from "./interruptions.ts";
import { checkLine, documentLine, documentsRefusal, mappingLines, receivedFiles, sourceLine } from "./knowledge-lines.ts";
import { keptTuning, modelOfArguments, modelReport } from "./model-lines.ts";
import { isConfigured, modelConnectionOf, openOperations, type Operations } from "./operations.ts";
import { RepositoryInit } from "./repository-init.ts";
import { MISSING_ADVICE, secretLine } from "./secret-lines.ts";
import { servedConsole } from "./served-console.ts";
import { exitCodeOf } from "./session-exit.ts";
import { listedLine, summaryLines } from "./session-lines.ts";
import { referredSession } from "./session-reference.ts";
import { ThreadOutput } from "./thread-output.ts";
import { typedValue } from "./typed-value.ts";
import { UsageError } from "./usage-error.ts";
import type { CommandIo } from "./command-io.ts";

/** What a command on sessions is given: the operations, what it was asked, and where it writes. */
interface Asked<Name extends Command["name"]> {
  readonly sessions: Sessions;
  readonly command: Extract<Command, { name: Name }>;
  readonly options: Arguments;
  readonly io: CommandIo;
}

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
  try {
    return await onSessions(command, options, repository, io);
  } catch (error) {
    const { kind, message } = failureOf(error);
    io.stderr.write(kind === "unexpected" ? `oqas stopped on an unexpected error: ${message}\n` : `${message}\n`);
    return kind === "refused" ? ExitCode.configuration : ExitCode.interrupted;
  }
}

/** Runs a command on the sessions or the configuration of a test repository, with the operations opened for it and let go of afterwards. */
async function onSessions(command: Exclude<Command, { name: "help" }>, options: Arguments, repository: string, io: CommandIo): Promise<ExitCodeValue> {
  if (command.name === "run") return opened({ command, options, io }, repository);
  if (command.name === "say") return said({ command, options, io }, repository);
  if (command.name === "ui") return servedConsole(command, repository, io);
  if (command.name === "converse") {
    if (io.terminal === undefined) throw new UsageError(NO_TERMINAL);
    // A folder never configured is set up step by step first, as the console does; the conversation opens once it is.
    if (!isConfigured(repository)) {
      const { setupProject } = await import("./conversation/project-setup/setup-project.ts");
      if (!(await setupProject(repository, io.terminal, io))) return ExitCode.interrupted;
    }
    // The conversation and what draws it are loaded here and nowhere else, so that no other command pays for them.
    const { converse } = await import("./conversation/converse.ts");
    return converse({ repository, terminal: io.terminal, io, ...(command.environment === undefined ? {} : { environment: command.environment }) });
  }
  const { sessions, configuration, documents, secrets, sources, mapping, close } = await openOperations(io, repository, false);
  try {
    switch (command.name) {
      case "init":
        return await new RepositoryInit({
          repositoryRoot: repository,
          configuration,
          playwrightVersion: playwrightVersion(),
          write: (line) => io.stderr.write(line),
          print: (line) => io.stdout.write(line),
        }).run();
      case "config":
        return await configured({ configuration, command, options, io });
      case "knowledge":
        if (command.action === "check") return await checked({ configuration, sources, command, options, io });
        if (command.action === "mapping") return mapped(await mapping.state(), options, io);
        return await known({ configuration, documents, command, options, io });
      case "model":
        return command.action === "setup" ? await setUp({ configuration, secrets }, io) : await modelled({ configuration, secrets, command, options, io });
      case "secrets":
        return await valued({ secrets, command, options, io });
      case "sessions":
        return await listed({ sessions, command, options, io });
      case "show":
        return await shown({ sessions, command, options, io });
      case "attach":
        return await attached({ sessions, command, options, io });
      case "stop":
        return await stopped({ sessions, command, options, io });
    }
  } finally {
    await close();
  }
}

/**
 * `oqas config`: prints the configuration in force and how the configuration file stands to it; with `import`,
 * takes the file as the configuration in force first, when it changed; with `export`, writes the configuration in
 * force over the file first, when it changed.
 */
async function configured({
  configuration,
  command,
  options,
  io,
}: Omit<Asked<"config">, "sessions"> & { configuration: Configuration }): Promise<ExitCodeValue> {
  if (command.action === "import") await configuration.synchronise();
  if (command.action === "export") await configuration.restore();
  const view: ConfigurationView = await configuration.view();
  const { revision, file } = view;
  const lines = [revision === undefined ? "The instance keeps no revision of the configuration." : revisionLine(revision), fileLine(file)];
  const document = command.action === "show" && revision !== undefined ? `\n${configurationText(revision.document).trimEnd()}` : "";
  print({ options, io }, `${lines.join("\n")}${document}`, view);
  return ExitCode.passed;
}

/**
 * `oqas model`: tests the connection to the model in force, and lists the models it offers; with `set`, records the
 * connection it is given as a revision of origin `command` first, which rewrites `oqas.json`, keeping the tuning of
 * the connection in force when it names the same model the same way. Exits with `0` when the
 * model answers and is among those offered, with `4` otherwise.
 */
async function modelled({
  configuration,
  secrets,
  command,
  options,
  io,
}: Omit<Asked<"model">, "sessions" | "command"> & {
  configuration: Configuration;
  secrets: Secrets;
  command: Exclude<Extract<Command, { name: "model" }>, { action: "setup" }>;
}): Promise<ExitCodeValue> {
  if (command.action === "set") {
    const inForce = await configuration.synchronise();
    const model = keptTuning(modelOfArguments(command.connection), inForce.document.model);
    await configuration.save({ ...inForce.document, model }, inForce.number, false, "command");
  }
  const revision = (await configuration.synchronise()).document;
  const report = modelReport(revision.model, await modelConnectionOf(io, secrets).check(revision.model));
  print({ options, io }, report.text, report.value);
  return report.code;
}

/**
 * `oqas secrets`: lists the variables the configuration in force names, and where the value of each comes from; with
 * `set`, saves the value of one first, typed in the terminal or read from the input.
 */
async function valued({ secrets, command, options, io }: Omit<Asked<"secrets">, "sessions"> & { secrets: Secrets }): Promise<ExitCodeValue> {
  if (command.action === "set") {
    await secrets.save(command.variable, await typedValue(io, `Value of ${command.variable} (not shown): `));
    io.stderr.write(`${command.variable} is saved on this machine, out of the test repository.\n`);
  }
  const listed = await secrets.list();
  const lines = listed.length === 0 ? ["The configuration in force names no variable."] : listed.map(secretLine);
  if (listed.some(({ source }) => source === "missing")) lines.push(MISSING_ADVICE);
  print({ options, io }, lines.join("\n"), { secrets: listed });
  return ExitCode.passed;
}

/** `oqas model` alone: sets the connection to the model step by step, in a terminal. */
async function setUp(operations: Pick<Operations, "configuration" | "secrets">, io: CommandIo): Promise<ExitCodeValue> {
  if (io.terminal === undefined) throw new UsageError(SETUP_TERMINAL);
  // The setting and what draws it are loaded here and nowhere else, as the conversation is.
  const { setupModel } = await import("./conversation/model-setup/setup-command.ts");
  return setupModel(operations, io.terminal, io);
}

/**
 * `oqas knowledge`: lists the knowledge sources of the configuration in force, each with the documents the instance
 * keeps of it when it is declared stored; with `add-document`, uploads files to such a source first, then lists it.
 */
async function known({
  configuration,
  documents,
  command,
  options,
  io,
}: Omit<Asked<"knowledge">, "sessions" | "command"> & {
  configuration: Configuration;
  documents: KnowledgeDocuments;
  command: Exclude<Extract<Command, { name: "knowledge" }>, { action: "check" | "mapping" }>;
}): Promise<ExitCodeValue> {
  if (command.action === "add-document") {
    const files = await receivedFiles(io.cwd, command.files);
    try {
      await documents.upload(command.source, files);
    } catch (error) {
      const refusal = documentsRefusal(error, command.files);
      throw refusal === undefined ? error : new UsageError(refusal);
    }
    const kept = await documents.list(command.source);
    const lines = [`${files.length === 1 ? "1 document was" : `${files.length} documents were`} uploaded to ${command.source}.`, ...kept.map(documentLine)];
    print({ options, io }, lines.join("\n"), { source: command.source, documents: kept });
    return ExitCode.passed;
  }
  const sources = (await configuration.view()).revision?.document.knowledge ?? [];
  if (sources.length === 0) {
    print({ options, io }, "The configuration in force declares no knowledge source.", { sources: [] });
    return ExitCode.passed;
  }
  const listed = await Promise.all(sources.map(async (source) => ({ source, kept: isStoredDocuments(source) ? await documents.list(source.id) : undefined })));
  const lines = listed.flatMap(({ source, kept }) => [
    sourceLine(source),
    ...(kept === undefined ? [] : kept.length === 0 ? ["  no document yet"] : kept.map(documentLine)),
  ]);
  print({ options, io }, lines.join("\n"), { sources: listed.map(({ source, kept }) => (kept === undefined ? source : { ...source, documents: kept })) });
  return ExitCode.passed;
}

/**
 * `oqas knowledge check`: tests that the knowledge sources of the configuration in force answer, or the one named,
 * without the model and indexing nothing. Exits with `0` when each answers, with `4` otherwise.
 */
async function checked({
  configuration,
  sources,
  command,
  options,
  io,
}: Omit<Asked<"knowledge">, "sessions" | "command"> & {
  configuration: Configuration;
  sources: KnowledgeSources;
  command: Extract<Command, { name: "knowledge"; action: "check" }>;
}): Promise<ExitCodeValue> {
  const declared = (await configuration.synchronise()).document.knowledge;
  const asked = command.source === undefined ? declared : declared.filter(({ id }) => id === command.source);
  if (asked.length === 0)
    throw new UsageError(
      command.source === undefined
        ? "The configuration in force declares no knowledge source."
        : `The configuration in force declares no knowledge source ${command.source}; oqas knowledge list lists them.`,
    );
  const checks = await Promise.all(asked.map(async (source) => ({ source: source.id, check: await sources.check(source) })));
  print({ options, io }, checks.map(checkLine).join("\n"), { checks });
  return checks.some(({ check }) => check.state === "failed") ? ExitCode.prerequisite : ExitCode.passed;
}

/** `oqas knowledge mapping`: tells where the cartography of the knowledge stands, source by source, and its index. */
function mapped(state: CartographyState, options: Arguments, io: CommandIo): ExitCodeValue {
  print({ options, io }, mappingLines(state).join("\n"), state);
  return ExitCode.passed;
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
