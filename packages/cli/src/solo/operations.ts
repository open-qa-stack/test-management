import { join } from "node:path";
import { CONFIG_FILE_NAME } from "@open-qa-stack/domain";
import { Configuration, KnowledgeDocuments, liveRuntime, ModelConnection, Sessions, type SessionsHost } from "@open-qa-stack/engine";
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
 * it is asked about.
 *
 * @param io - The environment and the outputs of the command.
 * @param repository - Absolute path of the test repository.
 * @param hosts - Whether the command opens a session, which it then runs.
 * @returns The operations, on a database whose schema is in order.
 * @throws {@link UsageError} when the database cannot be told: its URL is no URL, or the repository holds no configuration to place it by.
 * @throws `PendingMigrationsError` when the database is on a server that has migrations pending.
 * @throws `DatabaseUnavailableError` when the file of the database cannot be opened.
 */
export async function openOperations(io: CommandIo, repository: string, hosts: boolean): Promise<Operations> {
  const logger = commandLogger(io);
  const instance = new InstanceDatabase(databaseOf(io, repository), logger);
  const configuration = new Configuration(instance.configuration, repository);
  const sessions = new Sessions({
    ...runsOf(io),
    store: instance.sessions,
    configuration,
    documents: instance.documents,
    executions: instance.executions,
    repository: hosts ? repository : undefined,
    takesOver: false,
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
  return { sessions, configuration, documents: new KnowledgeDocuments(instance.documents, instance.configuration), close };
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
export function runsOf(io: CommandIo): Pick<SessionsHost, "env" | "openRuntime" | "runner" | "now" | "pace"> {
  const connect = io.connect ?? liveRuntime;
  return {
    env: io.env,
    openRuntime: (config) => connect(config, io.env),
    ...(io.runner === undefined ? {} : { runner: io.runner }),
    ...(io.now === undefined ? {} : { now: io.now }),
    ...(io.pace === undefined ? {} : { pace: io.pace }),
  };
}

/**
 * @param io - The environment of the command.
 * @param repository - Absolute path of the test repository.
 * @returns The URL of the database of the instance, from the environment of the command and its test repository.
 * @throws {@link UsageError} when the database cannot be told: its URL is no URL, or the repository holds no configuration to place it by.
 */
export function databaseOf(io: CommandIo, repository: string): DatabaseUrl {
  const raw = io.env[DATABASE_URL_VARIABLE];
  const given = raw === undefined ? undefined : DatabaseUrl.parse(raw);
  if (raw !== undefined && given === undefined) throw new UsageError(`${DATABASE_URL_VARIABLE} must be ${DatabaseUrl.rule}.`);
  try {
    return instanceDatabaseUrl(given, repository);
  } catch {
    const path = join(repository, CONFIG_FILE_NAME);
    throw new UsageError(
      `${path} cannot be read; oqas needs a ${CONFIG_FILE_NAME} at the root of the test repository, which says where its sessions are kept.`,
    );
  }
}

/**
 * The test of the connection to the model a command makes: with the probes it is given, or with the GitHub account of
 * the machine and the server of the provider.
 *
 * @param io - The environment of the command, which the key of a provider is read from.
 * @returns The operation.
 */
export function modelConnectionOf(io: CommandIo): ModelConnection {
  return io.probes === undefined ? new ModelConnection(io.env) : new ModelConnection(io.env, io.probes);
}
