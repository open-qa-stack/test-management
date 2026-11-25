import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_FILE_NAME, ExitCode, configurationText, type ConfigurationView, type ExitCodeValue, type RevisionSummary } from "@open-qa-stack/domain";
import type { Configuration } from "@open-qa-stack/engine";
import { UsageError } from "../errors/usage-error.ts";
import { errorLine, fileLine, revisionLine } from "../output/configuration-lines.ts";
import type { Asked } from "./asked.ts";
import { linesOr, print } from "./print.ts";

/** `oqas config history`: lists the revisions of the configuration, the latest first, and where each was made. */
export function historied(revisions: readonly RevisionSummary[], printing: Pick<Asked<"config">, "options" | "io">): ExitCodeValue {
  print(printing, linesOr(revisions.map(revisionLine), "The instance keeps no revision of the configuration."), { items: revisions });
  return ExitCode.passed;
}

/** `oqas config check`: checks the configuration file without taking it. Exits with `0` when it is valid, `3` otherwise. */
export async function fileChecked(configuration: Configuration, repository: string, printing: Pick<Asked<"config">, "options" | "io">): Promise<ExitCodeValue> {
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

/**
 * `oqas config`: prints the configuration in force and how the configuration file stands to it; with `import`,
 * takes the file as the configuration in force first, when it changed; with `export`, writes the configuration in
 * force over the file first, when it changed.
 */
export async function configured({
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
