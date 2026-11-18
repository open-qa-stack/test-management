import type { ToolDefinition } from "@open-qa-stack/domain";
import { scopedToolName } from "../common/tool-name.ts";
import type { DocumentSet } from "./document-set.ts";

/** Longest text a read returns, in characters; a longer one is cut, and read section by section. */
export const MAX_READ_CHARS = 20_000;
/** Most lines a search returns. */
export const MAX_SEARCH_MATCHES = 30;
/** Longest line a search returns as it is, in characters. */
const MAX_MATCH_LENGTH = 200;

/**
 * The tools of a document knowledge source: list its documents folder by folder, list the sections of one,
 * read one or one of its sections, and search them all.
 *
 * @remarks
 * A source is one document or a folder of them. The tools let an agent go by levels instead of reading
 * everything: `list_files` gives the folders and the documents of one folder, each document with its title,
 * its number of headings and its length; `list_sections` gives the headings of a document, each with the
 * length of its section; `read_section` and `read_file` give a text, cut at `MAX_READ_CHARS`; `search` finds
 * the lines that hold a text, each with its document and its section. Every tool reads the source the
 * configuration declares, and nothing else. `file` may be left out when the source is one document.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param documents - Its documents.
 * @returns The five tools.
 */
export function documentTools(knowledgeId: string, documents: DocumentSet): ToolDefinition[] {
  const file = { type: "string", description: "Path of the document, as list_files gives it; may be left out when the source is one document." };
  const named = (action: string) => scopedToolName(knowledgeId, action);
  const cut = (text: string) =>
    text.length <= MAX_READ_CHARS
      ? text
      : `${text.slice(0, MAX_READ_CHARS)}\n\n[Cut at ${MAX_READ_CHARS} of ${text.length} characters. Read the rest section by section, with ${named("list_sections")} then ${named("read_section")}.]`;
  return [
    {
      name: named("list_files"),
      description: `Lists what one folder of ${knowledgeId} holds: its folders, each with how many documents are under it, and its documents, each with its title, its number of headings and its length. Without folder, lists the root.`,
      parameters: {
        type: "object",
        properties: { folder: { type: "string", description: "Path of the folder, as a listing gives it; the root when left out." } },
        additionalProperties: false,
      },
      execute: async (args) => {
        const folder = ((args as { folder?: string }).folder ?? "").replace(/^\.?\/+|(?<!\/)\/+$/g, "");
        const listing = await documents.list();
        const prefix = folder === "" ? "" : `${folder}/`;
        const under = (path: string) => path.startsWith(prefix);
        const direct = (path: string) => under(path) && !path.slice(prefix.length).includes("/");
        const folders = new Map<string, number>();
        for (const { path } of listing.files.filter((document) => under(document.path) && !direct(document.path))) {
          const child = `${prefix}${path.slice(prefix.length).split("/")[0]}`;
          folders.set(child, (folders.get(child) ?? 0) + 1);
        }
        return {
          folders: [...folders].map(([path, count]) => ({ path, documents: count })),
          documents: listing.files.filter((document) => direct(document.path)),
          ...(listing.unreadable.some(direct) ? { unreadable: listing.unreadable.filter(direct) } : {}),
          ...(listing.truncated ? { truncated: true } : {}),
        };
      },
    },
    {
      name: named("list_sections"),
      description: `Lists the sections of a document of ${knowledgeId}, without its text: number, level, title and length of each.`,
      parameters: { type: "object", properties: { file }, additionalProperties: false },
      execute: async (args) =>
        (await documents.sections((args as { file?: string }).file)).map(({ number, level, title, text }) => ({ number, level, title, chars: text.length })),
    },
    {
      name: named("read_section"),
      description: `Returns the text of one section of a document of ${knowledgeId}, by its number, with the sections it holds.`,
      parameters: { type: "object", properties: { file, number: { type: "integer", minimum: 1 } }, required: ["number"], additionalProperties: false },
      execute: async (args) => {
        const { file: path, number } = args as { file?: string; number: number };
        const section = (await documents.sections(path)).find((candidate) => candidate.number === number);
        return section === undefined ? { error: `The document has no section ${number}.` } : cut(section.text);
      },
    },
    {
      name: named("read_file"),
      description: `Returns the whole text of a document of ${knowledgeId}, cut past ${MAX_READ_CHARS} characters: list its sections first when it is long.`,
      parameters: { type: "object", properties: { file }, additionalProperties: false },
      execute: async (args) => cut(await documents.read((args as { file?: string }).file)),
    },
    {
      name: named("search"),
      description: `Finds the lines of the documents of ${knowledgeId} that hold a text, whatever its case: each with its document and the section it is in. ${MAX_SEARCH_MATCHES} lines at most.`,
      parameters: { type: "object", properties: { text: { type: "string", minLength: 1 } }, required: ["text"], additionalProperties: false },
      execute: async (args) => {
        const wanted = (args as { text: string }).text.toLowerCase();
        const matches: { file: string; section?: number; title?: string; line: string }[] = [];
        for (const { path } of (await documents.list()).files) {
          for (const section of await documents.sections(path)) {
            // A line belongs to the deepest section that holds it: the lines of a section down to its first deeper heading.
            const own = section.text.split("\n").slice(1);
            const end = own.findIndex((line) => /^ {0,3}#{1,6}\s/.test(line));
            for (const line of end === -1 ? own : own.slice(0, end)) {
              if (matches.length < MAX_SEARCH_MATCHES && line.toLowerCase().includes(wanted))
                matches.push({ file: path, section: section.number, title: section.title, line: line.trim().slice(0, MAX_MATCH_LENGTH) });
            }
          }
        }
        return matches;
      },
    },
  ];
}
