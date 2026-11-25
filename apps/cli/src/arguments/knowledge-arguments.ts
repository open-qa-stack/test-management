import type { Command } from "./command.ts";

/** What `oqas knowledge` asks for, or why it is refused: a list, or the documents to add to a source, and nothing of a session. */
export function knowledgeOf(words: readonly string[], ofASession: boolean): Command | string {
  const [action, source, ...files] = words;
  if (ofASession) return "oqas knowledge acts on the knowledge sources: it takes no --brief, --environment nor --follow.";
  if ((action === "list" || action === "mapping") && source === undefined) return { name: "knowledge", action };
  if (action === "domains" && source === undefined) return { name: "knowledge", action };
  const [document] = files;
  if (source !== undefined && (action === "exclude" || action === "restore") && files.length === 0)
    return { name: "knowledge", action: "domain", domain: source, change: { excluded: action === "exclude" } };
  if (source !== undefined && action === "rename" && document !== undefined && files.length === 1)
    return { name: "knowledge", action: "domain", domain: source, change: { label: document } };
  if (action === "read" && source !== undefined && document !== undefined && files.length === 1) return { name: "knowledge", action, source, document };
  if (action === "remove" && source !== undefined && document !== undefined && files.length === 1) return { name: "knowledge", action, source, document };
  if (action === "add-document" && source !== undefined && files.length > 0) return { name: "knowledge", action, source, files };
  if (action === "check" && files.length === 0) return { name: "knowledge", action, ...(source === undefined ? {} : { source }) };
  if (action === "remap" && files.length === 0) return { name: "remap", ...(source === undefined ? {} : { source }) };
  return "oqas knowledge takes list, mapping or domains, check or remap and a source at most, exclude or restore then a domain, rename then a domain and its name, read or remove then a source and a document, or add-document then a source and one file at least.";
}
