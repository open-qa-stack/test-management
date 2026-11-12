/**
 * Names a tool of a knowledge source, so that tools of different sources never clash.
 *
 * @param knowledgeId - Identifier of the knowledge source, a slug.
 * @param action - What the tool does, in snake case.
 * @returns A name the model can call: letters, digits and underscores.
 */
export function knowledgeToolName(knowledgeId: string, action: string): string {
  return `${knowledgeId.replaceAll("-", "_")}_${action}`;
}
