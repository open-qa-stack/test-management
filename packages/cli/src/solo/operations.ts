import { join } from "node:path";
import { CONFIG_FILE_NAME } from "@open-qa-stack/domain";
import { liveRuntime, Sessions } from "@open-qa-stack/engine";
import { DATABASE_URL_VARIABLE, DatabaseUrl, InstanceDatabase, instanceDatabaseUrl } from "@open-qa-stack/store";
import { UsageError } from "./usage-error.ts";
import type { CommandIo } from "./command-io.ts";

/** The operations on the sessions of a test repository, as a command has them, and how to let go of them. */
export interface Operations {
  readonly sessions: Sessions;
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
  const logger = { log: () => undefined, warn: (message: string) => void io.stderr.write(`oqas: ${message}\n`) };
  const instance = new InstanceDatabase(databaseOf(io, repository), logger);
  const connect = io.connect ?? liveRuntime;
  const sessions = new Sessions({
    store: instance.sessions,
    repository: hosts ? repository : undefined,
    takesOver: false,
    env: io.env,
    logger,
    openRuntime: (config) => connect(config, io.env),
    ...(io.runner === undefined ? {} : { runner: io.runner }),
    ...(io.now === undefined ? {} : { now: io.now }),
    ...(io.pace === undefined ? {} : { pace: io.pace }),
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
  return { sessions, close };
}

/** The URL of the database of the instance, from the environment of the command and its test repository. */
function databaseOf(io: CommandIo, repository: string): DatabaseUrl {
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
