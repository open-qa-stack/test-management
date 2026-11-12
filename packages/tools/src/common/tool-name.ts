/**
 * Names a tool after what it belongs to, so that tools of different knowledge sources or applications
 * never clash.
 *
 * @param scopeId - Identifier of the knowledge source or application, a slug.
 * @param action - What the tool does, in snake case.
 * @returns A name the model can call: letters, digits and underscores.
 */
export function scopedToolName(scopeId: string, action: string): string {
  return `${scopeId.replaceAll("-", "_")}_${action}`;
}
