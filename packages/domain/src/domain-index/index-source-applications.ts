import { sourceApplications } from "../config/knowledge-reach.ts";
import type { Knowledge } from "../config/types.ts";
import type { IndexSource } from "./types.ts";

/**
 * Tells the applications a source of the domain index describes, from the configuration rather than from the index, so
 * that an index written before applications were told reads the same: the user interface of an application describes
 * it; a knowledge source, the applications it is attached to.
 *
 * @param source - The source of the index.
 * @param knowledge - The knowledge sources of the configuration.
 * @returns Their identifiers; none for a source of the whole project, or one the configuration no longer declares.
 */
export function indexSourceApplications(
  source: Pick<IndexSource, "id" | "type">,
  knowledge: readonly Pick<Knowledge, "id" | "attachments">[],
): readonly string[] {
  if (source.type === "web") return [source.id];
  const declared = knowledge.find((candidate) => candidate.id === source.id);
  return declared === undefined ? [] : sourceApplications(declared);
}
