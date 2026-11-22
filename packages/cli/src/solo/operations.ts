import { existsSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME, DATABASE_FILE_NAME, DEFAULT_REPOSITORY, type Model } from "@open-qa-stack/domain";
import {
  Campaigns,
  Configuration,
  Executions,
  FileSecretStore,
  KnowledgeDocuments,
  KnowledgeDomains,
  KnowledgeMapping,
  KnowledgeSources,
  liveRuntime,
  ModelConnection,
  RepositorySetup,
  RepositoryTests,
  Secrets,
  Sessions,
  START_ADVICE,
  TestReadings,
  type Environment,
  type EnvironmentSource,
  type SessionsHost,
} from "@open-qa-stack/engine";
import { DATABASE_URL_VARIABLE, DatabaseUrl, InstanceDatabase, instanceDatabaseUrl } from "@open-qa-stack/store";
import { UsageError } from "./usage-error.ts";
import type { CommandIo } from "./command-io.ts";

/** The operations on the sessions, on the configuration and on the documents of a test repository, as a command has them, and how to let go of them. */
export interface Operations {
  readonly sessions: Sessions;
  /** The operations on the configuration of the test repository. */
  readonly configuration: Configuration;
  /** The operations on the documents of the knowledge sources the instance keeps. */
  readonly documents: KnowledgeDocuments;
  /** The operations on the values of the variables the configuration names, which complete the environment of the runs. */
  readonly secrets: Secrets;
  /** The test of the knowledge sources, with the environment the runs read. */
  readonly sources: KnowledgeSources;
  /** Where the cartography of the knowledge stands. */
  readonly mapping: KnowledgeMapping;
  /** The tests of the test repository. */
  readonly tests: RepositoryTests;
  /** The tests of the test repository read in steps, from the runs that ran them. */
  readonly readings: TestReadings;
  /** The executions of tests the instance keeps. */
  readonly executions: Executions;
  /** The campaigns of tests of the instance. */
  readonly campaigns: Campaigns;
  /** The domains the cartography found in the knowledge. */
  readonly domains: KnowledgeDomains;
  /** Where the test repository stands, and its preparation. */
  readonly setup: RepositorySetup;
  /**
   * Stops hosting, when the command hosted a session, and closes the database.
   *
   * @param withinMs - How long the session the command hosts is given to end, in milliseconds; ten seconds by default.
   */
  readonly close: (withinMs?: number) => Promise<void>;
}

/** How long the session a command hosts is given to end when the command leaves, in milliseconds. */
const STOP_WITHIN_MS = 10_000;

/**
 * Gives a command the operations on the sessions of a test repository, on the database of the instance: the
 * one `OQAS_DATABASE_URL` names or, without it, the SQLite file in the state folder of the repository — the
 * database a server started on the same repository reaches.
 *
 * @remarks
 * A command that opens a session hosts it: it runs the session in its own process, in the test repository,
 * and leaves the sessions that wait for another host to a host that stays. A command that reads the sessions
 * or posts to one is given no test repository to run in: it hosts nothing, and touches no session but the one
 * it is asked about. A command that stays, the conversation, maps the knowledge that waits for it, as a server does.
 *
 * @param io - The environment and the outputs of the command.
 * @param repository - Absolute path of the test repository.
 * @param hosts - Whether the command opens a session, which it then runs.
 * @param stays - Whether the command stays, and maps the knowledge of the sources added while it does.
 * @param unconfigured - Whether a test repository without a configuration file is refused, or set up.
 * @returns The operations, on a database whose schema is in order.
 * @throws {@link UsageError} when the database cannot be told: its URL is no URL, or the configuration file that places it cannot be read.
 * @throws `PendingMigrationsError` when the database is on a server that has migrations pending.
 * @throws `DatabaseUnavailableError` when the file of the database cannot be opened.
 */
export async function openOperations(
  io: CommandIo,
  repository: string,
  hosts: boolean,
  stays = false,
  unconfigured: "refused" | "started" = "refused",
): Promise<Operations> {
  const logger = commandLogger(io);
  const instance = new InstanceDatabase(databaseOf(io, repository, unconfigured), logger);
  const configuration = new Configuration(instance.configuration, repository);
  const secrets = new Secrets(configuration, io.env, FileSecretStore.of(repository));
  const sessions = new Sessions({
    ...runsOf(io),
    // The values saved for the variables of the configuration complete the environment of the command, read as each run starts.
    env: secrets,
    store: instance.sessions,
    configuration,
    documents: instance.documents,
    memory: instance.memory,
    executions: instance.executions,
    repository: hosts ? repository : undefined,
    takesOver: false,
    mapsKnowledge: stays,
    logger,
  });
  const close = async (withinMs = STOP_WITHIN_MS): Promise<void> => {
    if (hosts) await sessions.stop(withinMs);
    await instance.close();
  };
  try {
    await instance.prepare();
  } catch (error) {
    await instance.close();
    throw error;
  }
  const tests = new RepositoryTests(repository, instance.configuration);
  return {
    sessions,
    configuration,
    domains: new KnowledgeDomains(repository, instance.configuration),
    setup: new RepositorySetup(repository, configuration),
    campaigns: new Campaigns({ store: instance.campaigns, executions: instance.executions, tests, launcher: sessions }),
    documents: new KnowledgeDocuments(instance.documents, instance.configuration),
    secrets,
    sources: new KnowledgeSources(repository, secrets, instance.documents),
    mapping: new KnowledgeMapping(repository, configuration, instance.sessions),
    tests,
    readings: new TestReadings(repository, instance.configuration, instance.executions),
    executions: new Executions(instance.executions),
    close,
  };
}

/**
 * @param io - The outputs of the command.
 * @returns Where a command reports what goes wrong around its sessions: on its error output, under its name. What went as expected is not told.
 */
export function commandLogger(io: Pick<CommandIo, "stderr">): { log(message: unknown): void; warn(message: unknown): void; error(message: unknown): void } {
  const told = (message: unknown): void => void io.stderr.write(`oqas: ${String(message)}\n`);
  return { log: () => undefined, warn: told, error: told };
}

/**
 * @param io - What the command runs with.
 * @returns What the runs of the sessions a command hosts work with, in whichever presentation hosts them: its environment, and what it was given in place of the machine.
 */
export function runsOf(io: CommandIo): Pick<SessionsHost, "openRuntime" | "runner" | "now" | "pace"> & { readonly env: Environment } {
  return {
    env: io.env,
    openRuntime: io.connect ?? liveRuntime,
    ...(io.runner === undefined ? {} : { runner: io.runner }),
    ...(io.now === undefined ? {} : { now: io.now }),
    ...(io.pace === undefined ? {} : { pace: io.pace }),
  };
}

/**
 * @param io - The environment of the command.
 * @param repository - Absolute path of the test repository.
 * @returns The URL of the database of the instance, from the environment of the command and its test repository.
 * @param unconfigured - Whether a test repository without a configuration file is refused, or started: the console starts in it, to set it up.
 * @throws {@link UsageError} when the database cannot be told: its URL is no URL, the configuration file is missing and the command is refused there, or it cannot be read.
 */
export function databaseOf(io: CommandIo, repository: string, unconfigured: "refused" | "started" = "refused"): DatabaseUrl {
  const raw = io.env[DATABASE_URL_VARIABLE];
  const given = raw === undefined ? undefined : DatabaseUrl.parse(raw);
  if (raw !== undefined && given === undefined) throw new UsageError(`${DATABASE_URL_VARIABLE} must be ${DatabaseUrl.rule}.`);
  // Only the console starts in a folder never configured, where it sets the configuration up: no other command writes a database
  // there. A folder whose file went keeps its database, from which oqas config export writes the file again.
  if (given === undefined && unconfigured === "refused" && !holdsInstance(repository))
    throw new UsageError(`${join(repository, CONFIG_FILE_NAME)} is missing. ${START_ADVICE}`);
  try {
    return instanceDatabaseUrl(given, repository);
  } catch {
    const path = join(repository, CONFIG_FILE_NAME);
    throw new UsageError(`${path} cannot be read: it says where the sessions are kept. Correct it, or remove it and start again with oqas --ui.`);
  }
}

/**
 * The test of the connection to the model a command makes: with the probes it is given, or with the GitHub account of
 * the machine and the server of the provider.
 *
 * @param io - What the command runs with.
 * @param env - The environment the key of a provider is read from, or what reads it at each test; that of the command by default.
 * @returns The operation.
 */
export function modelConnectionOf(io: CommandIo, env: Environment | EnvironmentSource = io.env): ModelConnection {
  return io.probes === undefined ? new ModelConnection(env) : new ModelConnection(env, io.probes);
}

/**
 * Records the connection to the model a person set in a terminal, as a revision of origin `command`; then saves the
 * key they typed for its variable, out of the test repository.
 *
 * @param operations - The operations on the configuration and on the values of its variables.
 * @param model - The connection.
 * @param key - The key typed for the variable of the connection, when the person typed one.
 */
export async function savedModel({ configuration, secrets }: Pick<Operations, "configuration" | "secrets">, model: Model, key?: string): Promise<void> {
  const inForce = await configuration.current();
  await configuration.save({ ...inForce.document, model }, inForce.number, "command");
  // A key is typed for the variable of a provider alone, which the connection names.
  if (key !== undefined) await secrets.save((model as Extract<Model, { mode: "provider-key" }>).apiKeyEnv!, key);
}

/**
 * @param repository - Absolute path of the test repository.
 * @returns Whether it may hold a configuration: it holds its configuration file, or the database of an instance,
 * from which `oqas config export` writes the file again.
 */
export function holdsInstance(repository: string): boolean {
  return existsSync(join(repository, CONFIG_FILE_NAME)) || existsSync(join(repository, DEFAULT_REPOSITORY.stateDir, DATABASE_FILE_NAME));
}

/**
 * Tells whether a test repository is set up: its instance keeps a configuration, or its configuration file gives it
 * its first. A database left by a setting up that was left holds none.
 *
 * @param io - The environment of the command.
 * @param repository - Absolute path of the test repository.
 * @returns Whether it is set up.
 */
export async function isConfigured(io: CommandIo, repository: string): Promise<boolean> {
  if (existsSync(join(repository, CONFIG_FILE_NAME))) return true;
  if (io.env[DATABASE_URL_VARIABLE] === undefined && !holdsInstance(repository)) return false;
  const instance = new InstanceDatabase(databaseOf(io, repository, "started"), commandLogger(io));
  try {
    await instance.prepare();
    return (await instance.configuration.inForce()) !== undefined;
  } finally {
    await instance.close();
  }
}
