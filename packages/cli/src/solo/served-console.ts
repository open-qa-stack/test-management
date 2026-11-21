import { ExitCode, isRecord, type ExitCodeValue } from "@open-qa-stack/domain";
import { builtConsole } from "./built-console.ts";
import { Interruptions } from "./interruptions.ts";
import { commandLogger, databaseOf, runsOf } from "./operations.ts";
import { UsageError } from "./usage-error.ts";
import type { Command } from "./arguments.ts";
import type { CommandIo } from "./command-io.ts";

/** The addresses that name this machine to itself: what listens there is reached from nowhere else. */
const LOOPBACK = /^(localhost|127(\.\d+){3}|::1)$/;

/**
 * Words what a person is told once the console is served.
 *
 * @param host - The address the console listens on.
 * @param repository - Absolute path of the test repository.
 * @returns The lines: that the console is served and how to stop it, after a warning when it listens beyond this machine, where whoever reaches it acts on the repository.
 */
export function servedNotice(host: string, repository: string): string {
  const exposed = LOOPBACK.test(host) ? "" : `The console asks nobody who they are: whoever reaches ${host} opens and stops sessions in ${repository}.\n`;
  return `${exposed}The console of ${repository} is served at the address below. Ctrl-C stops it.\n`;
}

/** The console, once it is served. */
export interface StartedConsole {
  /** Its address. */
  readonly url: string;
  /** Stops it: the session it runs is asked to stop and awaited for a time. */
  readonly close: () => Promise<void>;
}

/**
 * Starts the console of the test repository in this process, with the operations on sessions in REST under it.
 *
 * @remarks
 * The package of the API is loaded here and nowhere else, so that no other command pays for an HTTP server.
 *
 * @param where - Where to listen.
 * @param repository - Absolute path of the test repository.
 * @param io - The environment and the outputs of the command.
 * @returns The console, listening.
 * @throws {@link UsageError} when the console is not built, the database cannot be told, or the port is taken.
 */
export async function startConsole(
  { host, port }: Pick<Extract<Command, { name: "ui" }>, "host" | "port">,
  repository: string,
  io: CommandIo,
): Promise<StartedConsole> {
  const settings = {
    host,
    port,
    repository,
    database: databaseOf(io, repository, "started"),
    console: builtConsole(io.console),
    // The console stays: it maps the knowledge of the sources added in it.
    runs: { ...runsOf(io), mapsKnowledge: true },
    logger: commandLogger(io),
  };
  const { startApi } = await import("@open-qa-stack/api");
  return startApi(settings).catch((error: unknown) => {
    if (!isRecord(error) || error["code"] !== "EADDRINUSE") throw error;
    throw new UsageError(`The port ${port} of ${host} is taken, by another oqas --ui maybe: give another with --port, or --port 0 for any free one.`);
  });
}

/**
 * `oqas --ui`: serves the console of the test repository in this process, with the operations on sessions in
 * REST under it, prints its address, and stays until the person stops it.
 *
 * @remarks
 * It is another presentation of the same operations, on the database the other commands reach, and not a
 * server of its own: the application is the one the API package starts, given what the command resolved from
 * its arguments — the repository, the database, where to listen, the built console. The sessions opened in
 * the console run in this process, one at a time; those another terminal runs are shown and followed in it.
 *
 * Ctrl-C closes it: the session it runs is asked to stop and awaited for a time, and its beats are withdrawn.
 * A second Ctrl-C leaves at once.
 *
 * @param command - Where to listen.
 * @param repository - Absolute path of the test repository.
 * @param io - The environment and the outputs of the command.
 * @returns `0` once it stopped; `5` when the person left without waiting for it.
 * @throws {@link UsageError} when the console is not built, the database cannot be told, or the port is taken.
 */
export async function servedConsole(command: Extract<Command, { name: "ui" }>, repository: string, io: CommandIo): Promise<ExitCodeValue> {
  const api = await startConsole(command, repository, io);
  io.stderr.write(servedNotice(command.host, repository));
  io.stdout.write(`${api.url}\n`);
  return new Promise<ExitCodeValue>((exit) => {
    const leave = (code: ExitCodeValue): void => {
      interruptions.end();
      exit(code);
    };
    const interruptions = new Interruptions(io, () => api.close().finally(() => leave(ExitCode.passed)), {
      asked: "The console stops: the session it runs is asked to stop, and ends soon.",
      failed: "The console did not stop as it should",
    });
    void interruptions.leftAtOnce.then(() => leave(ExitCode.interrupted));
  });
}
