import { START_ADVICE } from "@open-qa-stack/engine";
import {
  CONFIG_FILE_NAME,
  InvalidConfigurationError,
  NoConfigurationError,
  type ConfigError,
  type FileState,
  type RevisionSummary,
} from "@open-qa-stack/domain";

/** Where a revision comes from, in the words of the command. */
const ORIGINS: Readonly<Record<RevisionSummary["origin"], string>> = {
  file: `taken from ${CONFIG_FILE_NAME}`,
  console: "saved in the console",
  command: "saved by a command",
};

/** How the configuration file stands to the revision in force, with what to do when they differ. */
const FILE_STATES: Readonly<Record<FileState, string>> = {
  in_step: `${CONFIG_FILE_NAME} holds it.`,
  changed: `${CONFIG_FILE_NAME} differs from it: oqas config export writes the revision in force over it, oqas config import takes it instead.`,
  missing: `There is no ${CONFIG_FILE_NAME}: oqas config export writes the revision in force to it.`,
};

/**
 * @param revision - A revision of the configuration.
 * @returns The line that names it, with where it comes from and when it was recorded.
 */
export function revisionLine(revision: RevisionSummary): string {
  return `Revision ${revision.number} of the configuration, ${ORIGINS[revision.origin]} on ${revision.recordedAt}.`;
}

/**
 * @param file - How the configuration file stands to the revision in force.
 * @returns The line that says it, with what to do when they differ.
 */
export function fileLine(file: FileState): string {
  return FILE_STATES[file];
}

/**
 * Tells why the configuration cannot be had, and what to do.
 *
 * @param error - What the operations on the configuration raised.
 * @returns The lines that tell it, without a final newline; `undefined` for an error that is no refusal of the configuration.
 */
export function configurationRefusal(error: unknown): string | undefined {
  if (error instanceof NoConfigurationError) return `${error.message} ${START_ADVICE}`;
  if (!(error instanceof InvalidConfigurationError)) return undefined;
  const way =
    error.inForce === undefined
      ? `Correct ${CONFIG_FILE_NAME}.`
      : `Correct ${CONFIG_FILE_NAME}, or write the revision ${error.inForce} in force over it with oqas config export.`;
  return [...error.errors.map(errorLine), way].join("\n");
}

/**
 * @param error - An error of a configuration.
 * @returns The line that tells it where it is: `/` for the whole document.
 */
export function errorLine({ path, message }: Pick<ConfigError, "path" | "message">): string {
  return `${path || "/"}: ${message}`;
}
