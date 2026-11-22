import type { Attachment, Knowledge } from "./types.ts";

/**
 * Tells what a knowledge source is attached to.
 *
 * @param source - The source.
 * @returns Its attachments; none for a source of the whole project.
 */
export function attachmentsOf(source: Pick<Knowledge, "attachments">): readonly Attachment[] {
  return source.attachments ?? [];
}

/**
 * Tells whether a knowledge source is of the whole project, attached to no application.
 *
 * @param source - The source.
 * @returns Whether it is.
 */
export function isProjectWide(source: Pick<Knowledge, "attachments">): boolean {
  return attachmentsOf(source).length === 0;
}

/**
 * Tells whether a knowledge source is read in an environment: one of the whole project always is, one attached to
 * applications when one of its attachments names that environment, or none.
 *
 * @param source - The source.
 * @param environment - The name of the environment.
 * @returns Whether it is.
 */
export function isReadIn(source: Pick<Knowledge, "attachments">, environment: string): boolean {
  return isProjectWide(source) || attachmentsOf(source).some((attachment) => attachment.environment === undefined || attachment.environment === environment);
}

/**
 * Tells the applications a knowledge source is attached to.
 *
 * @param source - The source.
 * @returns Their identifiers, each once, in the order of the attachments; none for a source of the whole project.
 */
export function sourceApplications(source: Pick<Knowledge, "attachments">): readonly string[] {
  return [...new Set(attachmentsOf(source).map(({ application }) => application))];
}
