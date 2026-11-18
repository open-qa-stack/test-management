import type { RevisionSummary } from "./configuration-revision.ts";

/**
 * How the configuration file stands to the revision in force: `in_step` when it is the file the revision was read from or
 * wrote, `changed` when it was changed since, or when no revision was recorded yet, and `missing` when it
 * cannot be read.
 */
export type FileState = "in_step" | "changed" | "missing";

/**
 * Tells how the configuration file stands to the revision in force.
 *
 * @param inForce - The revision in force; `undefined` when none was recorded.
 * @param digest - The digest of the file as it is now; `undefined` when it cannot be read.
 * @returns How the file stands.
 */
export function fileStateOf(inForce: RevisionSummary | undefined, digest: string | undefined): FileState {
  if (digest === undefined) return "missing";
  return inForce?.fileDigest === digest ? "in_step" : "changed";
}
