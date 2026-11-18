import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE_NAME, DATABASE_FILE_NAME, declaredStateDir } from "@open-qa-stack/domain";
import { DatabaseUrl } from "@open-qa-stack/store";

/**
 * Tells which database an instance keeps its state in: the one it was given the URL of or, without one, a
 * SQLite file in the state folder of its test repository, so that an instance needs nothing installed.
 *
 * @param given - The URL the instance was given, when it was given one.
 * @param repository - The test repository of the instance, when it has one: the variables are read so that
 * one of the two is there.
 * @returns The URL of the database.
 */
export function instanceDatabase(given: DatabaseUrl | undefined, repository: string | undefined): DatabaseUrl {
  if (given !== undefined) return given;
  const root = repository as string;
  return DatabaseUrl.ofFile(join(root, declaredStateDir(readFileSync(join(root, CONFIG_FILE_NAME), "utf8")), DATABASE_FILE_NAME));
}
