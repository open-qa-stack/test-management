import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { join, resolve } from "node:path";
import {
  CONFIG_FILE_NAME,
  configurationText,
  ExitCode,
  isStoredDocuments,
  type Campaign,
  type CartographyState,
  type RepositoryState,
  type RevisionSummary,
  type TestLaunch,
  type ConfigurationView,
  type ExitCodeValue,
} from "@open-qa-stack/domain";
import { playwrightVersion } from "@open-qa-stack/tools";
import type { Project, Session } from "@open-qa-stack/domain/sessions";
import type { Configuration, EnvironmentAddresses, KnowledgeDocuments, KnowledgeSources, Secrets, Sessions } from "@open-qa-stack/engine";
import { addressLine, type CheckedAddress } from "./address-lines.ts";
import type { Arguments, Command } from "./arguments.ts";
import { errorLine, fileLine, revisionLine } from "./configuration-lines.ts";
import { eventLine, ofTheAgents } from "./event-line.ts";
import { failureOf } from "./failure.ts";
import { checkLine, documentLine, documentsRefusal, mappingLines, receivedFiles, sourceLine } from "./knowledge-lines.ts";
import { campaignLine, overviewLine, progressLines } from "./campaign-lines.ts";
import { LaunchEndError } from "./launch-end-error.ts";
import { keptTuning, modelOfArguments, modelReport } from "./model-lines.ts";
import { modelConnectionOf, type Operations } from "./operations.ts";
import { RepositoryInit } from "./repository-init.ts";
import { MISSING_ADVICE, secretLine } from "./secret-lines.ts";
import { listedLine, summaryLines } from "./session-lines.ts";
import { referredSession } from "./session-reference.ts";
import { anomalyLine, executionLines, executionPageLines, readingLines, testExecutionLine, testLine, versionLine } from "./test-lines.ts";
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
  | Extract<
      Command,
      {
        name:
          | "init"
          | "config"
          | "knowledge"
          | "applications"
          | "secrets"
          | "sessions"
          | "show"
          | "stop"
          | "tests"
          | "executions"
          | "launch"
          | "campaigns"
          | "project"
          | "repository";
      }
    >
  | Extract<Command, { name: "model"; action: "status" | "set" }>;

/** The names of the commands that print, as {@link isPrinting} reads them: typed on them, it does not compile while one is left out. */
const PRINTING: Readonly<Record<PrintingCommand["name"], true>> = {
  init: true,
  config: true,
  knowledge: true,
  applications: true,
  secrets: true,
  sessions: true,
  show: true,
  stop: true,
  model: true,
  tests: true,
  executions: true,
  launch: true,
  campaigns: true,
  project: true,
  repository: true,
};

/**
 * Tells whether a command does what it is asked and ends at once, printing what it did.
 *
 * @param command - What the arguments ask for.
 * @returns Whether it is a {@link PrintingCommand}.
 */
export function isPrinting(command: Command): command is PrintingCommand {
  return Object.hasOwn(PRINTING, command.name) && !(command.name === "model" && command.action === "setup");
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
  const { sessions, configuration, documents, secrets, sources, mapping, addresses } = operations;
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
      if (command.action === "history") return historied(await configuration.revisions(), { options, io });
      if (command.action === "check") return await fileChecked(configuration, repository, { options, io });
      return await configured({ configuration, command, options, io });
    case "project":
      return projected(await sessions.project(), { options, io });
    case "repository":
      return stood(await operations.setup.state(), { options, io });
    case "applications":
      return await addressesChecked({ configuration, addresses, command, options, io });
    case "knowledge":
      if (command.action === "check") return await checked({ configuration, sources, command, options, io });
      if (command.action === "mapping") return mapped(await mapping.state(), options, io);
      if (command.action === "domains") return await domained(operations, { options, io });
      if (command.action === "read" || command.action === "remove") return await documented(documents, command, { options, io });
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
    case "tests":
      // The tests are read with the configuration of oqas.json, which says where the applications and the runs are.
      await configuration.inForce();
      return await tested(operations, command, { options, io });
    case "executions":
      return await executed(operations, command, { options, io });
    case "launch":
      return await launched(operations, command, { options, io });
    case "campaigns":
      // The tests of a campaign are read with the configuration of oqas.json, as those of oqas tests are.
      await configuration.inForce();
      return await campaigned(operations, command, { options, io });
  }
}

/** How often a launch that runs is asked how far it went, in milliseconds. */
const LAUNCH_BEAT_MS = 100;

/**
 * `oqas launch`: launches tests of the test repository as they are, with no agent, in this process, and follows them
 * to their end.
 */
async function launched(
  operations: Pick<Operations, "sessions" | "executions">,
  command: Extract<Command, { name: "launch" }>,
  printing: Pick<Asked<"launch">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { paths, environment } = command;
  const launch = await operations.sessions.launch({ ...(paths.length === 0 ? {} : { paths }), ...(environment === undefined ? {} : { environment }) });
  return followed(operations, launch, printing);
}

/**
 * Follows a launch of tests that runs in this process to its end: each test it finished on the error output, then the
 * execution it kept. Exits with `0` when each test passed, `1` when one failed, `2` when one was skipped, `5` when it
 * kept no execution.
 */
async function followed(
  { sessions, executions }: Pick<Operations, "sessions" | "executions">,
  launch: TestLaunch,
  printing: Pick<Asked<"launch">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { stderr } = printing.io;
  const { paths } = launch;
  stderr.write(`Tests launched against ${launch.environment}: ${paths.length === 0 ? "every test of the repository" : paths.join(", ")}.\n`);
  let told = 0;
  let state = await sessions.launches();
  // The launch is the one that runs until it is the last that ended: the next one waits for it.
  while (state.last?.startedAt !== launch.startedAt) {
    const finished = state.running?.progress?.finished ?? [];
    for (const { verdict, path, title } of finished.slice(told)) stderr.write(`${verdict.padEnd(7)} ${path} › ${title}\n`);
    told = Math.max(told, finished.length);
    await pause(LAUNCH_BEAT_MS);
    state = await sessions.launches();
  }
  const { execution: id, failure } = state.last;
  if (id === undefined) throw new LaunchEndError(failure);
  const execution = await executions.get(id);
  print(printing, executionLines(execution).join("\n"), execution);
  const verdicts = new Set(execution.results.map(({ verdict }) => verdict));
  if (verdicts.has("failed")) return ExitCode.failed;
  return verdicts.has("skipped") ? ExitCode.unsettled : ExitCode.passed;
}

/**
 * `oqas campaigns`: lists the campaigns; plans one, chooses its tests, makes it ready, launches its tests and follows
 * them to their end, prints it with what came of each test, or closes it.
 */
async function campaigned(
  operations: Pick<Operations, "campaigns" | "tests" | "sessions" | "executions">,
  command: Extract<Command, { name: "campaigns" }>,
  printing: Pick<Asked<"campaigns">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { campaigns } = operations;
  const told = (campaign: Campaign): ExitCodeValue => {
    print(printing, campaignLine(campaign), campaign);
    return ExitCode.passed;
  };
  switch (command.action) {
    case "list": {
      const items = await campaigns.list();
      print(printing, linesOr(items.map(overviewLine), "The instance keeps no campaign."), { items });
      return ExitCode.passed;
    }
    case "plan":
      return told(await campaigns.plan({ name: command.campaign, environment: command.environment }));
    case "choose": {
      // A file named stands for every test it holds.
      const named = new Set(command.paths);
      const tests = (await operations.tests.list()).filter(({ path }) => named.has(path)).map(({ path, title }) => ({ path, title }));
      const missing = command.paths.filter((path) => !tests.some((test) => test.path === path));
      if (missing.length > 0) throw new UsageError(`The test repository holds no test in ${missing.join(", ")}; oqas tests lists them.`);
      return told(await campaigns.choose(command.campaign, tests));
    }
    case "ready":
      return told(await campaigns.ready(command.campaign));
    case "close":
      return told(await campaigns.close(command.campaign));
    case "show": {
      const progress = await campaigns.progress(command.campaign);
      print(printing, progressLines(progress).join("\n"), progress);
      return ExitCode.passed;
    }
    case "launch":
      return followed(operations, await campaigns.launch(command.campaign, command.only), printing);
  }
}

/** The lines of a list, or what says it is empty. */
function linesOr(lines: readonly string[], none: string): string {
  return lines.length === 0 ? none : lines.join("\n");
}

/** How many executions `oqas executions` lists at a time. */
const EXECUTIONS_PAGE = 20;

/**
 * `oqas tests`: lists the tests of the test repository; with a test, reads it in steps, lists what came of its file in
 * the latest executions or the versions of its tests, or writes its trace or the capture of one of its steps to a file.
 */
async function tested(
  { tests, readings, executions, code }: Pick<Operations, "tests" | "readings" | "executions" | "code">,
  command: Extract<Command, { name: "tests" }>,
  printing: Pick<Asked<"tests">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { io } = printing;
  switch (command.action) {
    case "list": {
      const listed = await tests.listed();
      const lines = listed.items.length === 0 ? ["The test repository holds no test yet."] : listed.items.map(testLine);
      print(printing, [...lines, ...listed.anomalies.map(anomalyLine)].join("\n"), listed);
      return ExitCode.passed;
    }
    case "read": {
      const reading = await readings.read(command.path);
      print(printing, readingLines(reading).join("\n"), reading);
      return ExitCode.passed;
    }
    case "executions": {
      const items = await executions.ofFile(command.path);
      print(printing, linesOr(items.map(testExecutionLine), `No execution the instance keeps ran ${command.path}.`), { items });
      return ExitCode.passed;
    }
    case "versions": {
      const items = await executions.versions(command.path);
      print(printing, linesOr(items.map(versionLine), `The instance keeps no version of ${command.path}.`), { items });
      return ExitCode.passed;
    }
    case "source": {
      const source = await code.read(command.path);
      print(printing, source.content.trimEnd(), source);
      return ExitCode.passed;
    }
    case "change": {
      const changed = await code.change(command);
      print(printing, `${testLine(changed)}\nCommitted ${changed.path}; the test bears @oqas-id-${changed.id}.`, changed);
      return ExitCode.passed;
    }
    case "trace": {
      const file = resolve(io.cwd, command.file);
      await writeFile(file, await readings.trace(command.path));
      print(printing, `The trace of ${command.path} is written to ${file}: npx playwright show-trace opens it.`, { path: command.path, file });
      return ExitCode.passed;
    }
    case "capture": {
      const file = resolve(io.cwd, command.file);
      const { contentType, bytes } = await readings.capture(command.path, command.step);
      await writeFile(file, bytes);
      print(printing, `The capture of step ${command.step} of ${command.path} is written to ${file} (${contentType}).`, {
        path: command.path,
        step: command.step,
        file,
        contentType,
      });
      return ExitCode.passed;
    }
  }
}

/** `oqas executions`: lists the executions of tests, the latest first, a page at a time; with `show`, prints one. */
async function executed(
  { executions }: Pick<Operations, "executions">,
  command: Extract<Command, { name: "executions" }>,
  printing: Pick<Asked<"executions">, "options" | "io">,
): Promise<ExitCodeValue> {
  if (command.action === "show") {
    const execution = await executions.get(command.execution);
    print(printing, executionLines(execution).join("\n"), execution);
    return ExitCode.passed;
  }
  const { outcome, before } = command;
  const page = await executions.page({ limit: EXECUTIONS_PAGE, ...(outcome === undefined ? {} : { outcome }), ...(before === undefined ? {} : { before }) });
  print(printing, executionPageLines(page).join("\n"), page);
  return ExitCode.passed;
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

/** `oqas config history`: lists the revisions of the configuration, the latest first, and where each was made. */
function historied(revisions: readonly RevisionSummary[], printing: Pick<Asked<"config">, "options" | "io">): ExitCodeValue {
  print(printing, linesOr(revisions.map(revisionLine), "The instance keeps no revision of the configuration."), { items: revisions });
  return ExitCode.passed;
}

/** `oqas config check`: checks the configuration file without taking it. Exits with `0` when it is valid, `3` otherwise. */
async function fileChecked(configuration: Configuration, repository: string, printing: Pick<Asked<"config">, "options" | "io">): Promise<ExitCodeValue> {
  const text = await readFile(join(repository, CONFIG_FILE_NAME), "utf8").catch(() => {
    throw new UsageError(`The test repository holds no ${CONFIG_FILE_NAME} to check.`);
  });
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new UsageError(`${CONFIG_FILE_NAME} is no JSON: ${(error as Error).message}`);
  }
  const errors = configuration.check(document as object);
  print(printing, linesOr(errors.map(errorLine), `${CONFIG_FILE_NAME} is a valid configuration.`), { errors });
  return errors.length === 0 ? ExitCode.passed : ExitCode.configuration;
}

/** `oqas project`: names the project of the instance, as a host on the test repository names it, and its applications. */
function projected(project: Project, printing: Pick<Asked<"project">, "options" | "io">): ExitCodeValue {
  print(printing, [`The project ${project.name}.`, ...project.applications.map(({ id, name }) => `  ${name} (${id})`)].join("\n"), project);
  return ExitCode.passed;
}

/** How a test repository stands to git, in the words of the command. */
const GIT_STATES: Readonly<Record<RepositoryState["git"], string>> = {
  none: "it is no git repository",
  empty: "it is a git repository without a commit",
  ready: "it is a git repository with a commit",
};

/** `oqas repository`: tells where the test repository stands. */
function stood(state: RepositoryState, printing: Pick<Asked<"repository">, "options" | "io">): ExitCodeValue {
  const playwright = state.playwright ? "a Playwright project" : "no Playwright project yet: oqas --init prepares it";
  print(printing, `The test repository is ${state.folder}: ${GIT_STATES[state.git]}, and ${playwright}.`, state);
  return ExitCode.passed;
}

/** `oqas knowledge domains`: lists the domains the cartography found in the knowledge. */
async function domained({ domains }: Pick<Operations, "domains">, printing: Pick<Asked<"knowledge">, "options" | "io">): Promise<ExitCodeValue> {
  const items = await domains.list();
  const none = "The cartography found no domain yet: oqas knowledge mapping tells where it stands.";
  print(
    printing,
    linesOr(
      items.map(({ id, label, description }) => `${id}: ${label}. ${description}`),
      none,
    ),
    { items },
  );
  return ExitCode.passed;
}

/** `oqas knowledge read` and `remove`: prints a document a source of the instance keeps, or removes it. */
async function documented(
  documents: KnowledgeDocuments,
  command: Extract<Command, { name: "knowledge"; action: "read" | "remove" }>,
  printing: Pick<Asked<"knowledge">, "options" | "io">,
): Promise<ExitCodeValue> {
  const { source, document } = command;
  if (command.action === "read") {
    const read = await documents.read(source, document);
    print(printing, read.text.trimEnd(), read);
    return ExitCode.passed;
  }
  await documents.remove(source, document);
  print(printing, `The document ${document} is removed from ${source}.`, { source, document });
  return ExitCode.passed;
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
 * connection it is given as a revision of origin `command` first, keeping the tuning of
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
    const inForce = await configuration.current();
    const model = keptTuning(modelOfArguments(command.connection), inForce.document.model);
    await configuration.save({ ...inForce.document, model }, inForce.number, "command");
  }
  const revision = (await configuration.current()).document;
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
  command: Extract<Command, { name: "knowledge"; action: "list" | "add-document" }>;
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
  const declared = (await configuration.current()).document.knowledge;
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

/**
 * `oqas applications check`: tests that each address of the environments of the applications of the configuration in
 * force answers — that of the interface, those of the APIs —, or of the one named, without the model and writing
 * nothing. Exits with `0` when each answers, with `4` otherwise.
 */
async function addressesChecked({
  configuration,
  addresses,
  command,
  options,
  io,
}: Pick<Asked<"applications">, "command" | "options" | "io"> & { configuration: Configuration; addresses: EnvironmentAddresses }): Promise<ExitCodeValue> {
  const declared = (await configuration.current()).document.applications;
  const asked = command.application === undefined ? declared : declared.filter(({ id }) => id === command.application);
  // A configuration declares one application at least: only an application named may be missing.
  if (asked.length === 0) throw new UsageError(`The configuration in force declares no application ${command.application!}; oqas project names them.`);
  const named = asked.flatMap(({ id, environments }) =>
    environments.flatMap(({ name, uiUrl, apis = [] }) => [
      ...(uiUrl === undefined ? [] : [{ application: id, environment: name, address: "interface", url: uiUrl }]),
      ...apis.map((api) => ({ application: id, environment: name, address: api.name, url: api.baseUrl })),
    ]),
  );
  if (named.length === 0) throw new UsageError("The environments of the applications declare no address to test.");
  const checks: CheckedAddress[] = await Promise.all(named.map(async ({ url, ...where }) => ({ ...where, check: await addresses.check(url) })));
  print({ options, io }, checks.map(addressLine).join("\n"), { checks });
  return checks.every(({ check }) => check.state === "answers") ? ExitCode.passed : ExitCode.prerequisite;
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
