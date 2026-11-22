import { configurationText, ExitCode, isStoredDocuments, type CartographyState, type ConfigurationView, type ExitCodeValue } from "@open-qa-stack/domain";
import { playwrightVersion } from "@open-qa-stack/tools";
import type { Session } from "@open-qa-stack/domain/sessions";
import type { Configuration, KnowledgeDocuments, KnowledgeSources, Secrets, Sessions } from "@open-qa-stack/engine";
import type { Arguments, Command } from "./arguments.ts";
import { fileLine, revisionLine } from "./configuration-lines.ts";
import { eventLine, ofTheAgents } from "./event-line.ts";
import { failureOf } from "./failure.ts";
import { checkLine, documentLine, documentsRefusal, mappingLines, receivedFiles, sourceLine } from "./knowledge-lines.ts";
import { keptTuning, modelOfArguments, modelReport } from "./model-lines.ts";
import { modelConnectionOf, type Operations } from "./operations.ts";
import { RepositoryInit } from "./repository-init.ts";
import { MISSING_ADVICE, secretLine } from "./secret-lines.ts";
import { listedLine, summaryLines } from "./session-lines.ts";
import { referredSession } from "./session-reference.ts";
import { typedValue } from "./typed-value.ts";
import { UsageError } from "./usage-error.ts";
import type { CommandIo, CommandOutput } from "./command-io.ts";

/** What a command on sessions is given: the operations, what it was asked, and where it writes. */
export interface Asked<Name extends Command["name"]> {
  readonly sessions: Sessions;
  readonly command: Extract<Command, { name: Name }>;
  readonly options: Arguments;
  readonly io: CommandIo;
}

/**
 * A command that does what it is asked and ends at once, printing what it did: the same in the command and, after a
 * slash, in the conversation. Those that run or follow a session, serve the console or draw a screen are not.
 */
export type PrintingCommand =
  | Extract<Command, { name: "init" | "config" | "knowledge" | "secrets" | "sessions" | "show" | "stop" }>
  | Extract<Command, { name: "model"; action: "status" | "set" }>;

/** The names of the commands that print, as {@link isPrinting} reads them. */
const PRINTING: ReadonlySet<Command["name"]> = new Set(["init", "config", "knowledge", "secrets", "sessions", "show", "stop", "model"]);

/**
 * Tells whether a command does what it is asked and ends at once, printing what it did.
 *
 * @param command - What the arguments ask for.
 * @returns Whether it is a {@link PrintingCommand}.
 */
export function isPrinting(command: Command): command is PrintingCommand {
  return PRINTING.has(command.name) && !(command.name === "model" && command.action === "setup");
}

/**
 * Runs a command that prints, on operations already open: the command opens them for it alone, the conversation
 * hands it those it holds.
 *
 * @param operations - The operations of the test repository.
 * @param repository - Absolute path of the test repository.
 * @param command - What the arguments ask for.
 * @param options - How to print.
 * @param io - Where to write, and what a value is read from.
 * @returns The exit code of the command.
 */
export async function runPrinting(
  operations: Operations,
  repository: string,
  command: PrintingCommand,
  options: Arguments,
  io: CommandIo,
): Promise<ExitCodeValue> {
  const { sessions, configuration, documents, secrets, sources, mapping } = operations;
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
      return await modelled({ configuration, secrets, command, options, io });
    case "secrets":
      return await valued({ secrets, command, options, io });
    case "sessions":
      return await listed({ sessions, command, options, io });
    case "show":
      return await shown({ sessions, command, options, io });
    case "stop":
      return await stopped({ sessions, command, options, io });
  }
}

/**
 * Runs something a command asks, and tells what it raised as the command does: on the error output, with the code of
 * a refusal or of a failure.
 *
 * @param run - What the command does.
 * @param stderr - Where what it raised is told.
 * @returns The code it exits with: its own, `3` when it was refused, `5` when it failed.
 */
export async function caught(run: () => Promise<ExitCodeValue>, stderr: CommandOutput): Promise<ExitCodeValue> {
  try {
    return await run();
  } catch (error) {
    const { kind, message } = failureOf(error);
    stderr.write(kind === "unexpected" ? `oqas stopped on an unexpected error: ${message}\n` : `${message}\n`);
    return kind === "refused" ? ExitCode.configuration : ExitCode.interrupted;
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
export function print({ options, io }: Pick<Asked<Command["name"]>, "options" | "io">, text: string, value: unknown): void {
  io.stdout.write(`${options.output === "json" ? JSON.stringify(value) : text}\n`);
}

/** The session a command names, whatever it gave of its identifier. */
export async function named(sessions: Sessions, reference: string): Promise<Session> {
  return referredSession(await sessions.sessions(), reference);
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

/** What a command that prints did, as the conversation tells it. */
export interface Printed {
  /** What it wrote, on either output, in order. */
  readonly text: string;
  /** The code it exits with. */
  readonly code: ExitCodeValue;
}

/**
 * Runs a command that prints as the command does, keeping what it writes instead of writing it: for the conversation,
 * which shows it in its thread. It is given no terminal nor input to read a value from.
 *
 * @param operations - The operations the conversation holds.
 * @param repository - Absolute path of the test repository.
 * @param command - What was typed after the slash.
 * @param io - The environment and the folder of the command.
 * @returns What it wrote, and its code: what it raised is told as the command tells it.
 */
export async function printedBy(operations: Operations, repository: string, command: PrintingCommand, io: CommandIo): Promise<Printed> {
  const written: string[] = [];
  const kept: CommandOutput = { write: (text) => written.push(text) };
  const { terminal: _terminal, input: _input, ...rest } = io;
  const captured: CommandIo = { ...rest, stdout: kept, stderr: kept };
  const code = await caught(() => runPrinting(operations, repository, command, { output: "text", follow: false, command }, captured), kept);
  return { text: written.join("").trimEnd(), code };
}
