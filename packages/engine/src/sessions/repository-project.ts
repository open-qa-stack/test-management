import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { CONFIG_FILE_NAME, isRecord, parseJson } from "@open-qa-stack/domain";
import type { Project } from "@open-qa-stack/domain/sessions";

/**
 * Reads the project of an instance from the test repository its sessions run in.
 *
 * @remarks
 * Only what names the project is read, and nothing is validated: a configuration a run would refuse still
 * names its applications, and the session that runs on it tells what is wrong with it.
 *
 * @param repository - Absolute path of the test repository.
 * @returns The project: named after the folder of the repository, with the applications its configuration
 * declares, one that gives no name named after its identifier; without application when the configuration
 * cannot be read.
 */
export async function repositoryProject(repository: string): Promise<Project> {
  const configuration = parseJson(await readFile(join(repository, CONFIG_FILE_NAME), "utf8").catch(() => ""));
  const declared: readonly unknown[] = isRecord(configuration) && Array.isArray(configuration["applications"]) ? configuration["applications"] : [];
  return {
    name: basename(repository),
    applications: declared.flatMap((application) => {
      if (!isRecord(application)) return [];
      const { id, name } = application;
      return typeof id === "string" ? [{ id, name: typeof name === "string" ? name : id }] : [];
    }),
  };
}
