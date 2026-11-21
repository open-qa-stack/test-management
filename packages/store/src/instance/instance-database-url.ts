import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME, DATABASE_FILE_NAME, declaredStateDir, DEFAULT_REPOSITORY } from "@open-qa-stack/domain";
import { DatabaseUrl } from "../database/database-url.ts";

/** The environment variable every process of an instance reads the connection URL of its database from. */
export const DATABASE_URL_VARIABLE = "OQAS_DATABASE_URL";

/**
 * Tells which database an instance keeps its state in: the one it was given the URL of or, without one, a
 * SQLite file in the state folder of its test repository, so that an instance needs nothing installed.
 *
 * @remarks
 * Every process of an instance asks here, a server and a terminal alike: given the same settings, they reach
 * the same database.
 *
 * @param given - The URL the instance was given, when it was given one.
 * @param repository - The test repository of the instance, when it has one: whoever asks sees to it that one of
 * the two is there. A repository without a configuration file yet keeps its database in the state folder by default,
 * `.oqas`, so that an instance starts before it is configured.
 * @returns The URL of the database.
 * @throws The error of the file system when no URL was given and the configuration file is there but cannot be read.
 */
export function instanceDatabaseUrl(given: DatabaseUrl | undefined, repository: string | undefined): DatabaseUrl {
  if (given !== undefined) return given;
  const root = repository as string;
  const file = join(root, CONFIG_FILE_NAME);
  const stateDir = existsSync(file) ? declaredStateDir(readFileSync(file, "utf8")) : DEFAULT_REPOSITORY.stateDir;
  return DatabaseUrl.ofFile(join(root, stateDir, DATABASE_FILE_NAME));
}
