import { scopedToolName, type DocumentFile } from "@open-qa-stack/tools";
import { MAX_DOMAIN_FILE_LENGTH } from "../source-workflow/domain-file-control.ts";
import { SET_ASIDE_TOOL, WRITE_DOMAIN_TOOL } from "../source-workflow/handed-in-map.ts";
import { promptOf, type PromptTemplate } from "../common/prompt-template.ts";

/** Most documents of the root the request lists. */
const MAX_LISTED = 40;

/** The prompt of the agent that maps the documents of one source, with the tools of the source, those it hands its map in with, and how long a file may be. */
export const DOCUMENT_CARTOGRAPHER_PROMPT = {
  template: `You map the documents of one source of an application — specifications, guides, rules — into functional domains, for the agents that write tests. They read your map to know which document, which section to open; they open the documents themselves only when your map is not enough. You read these documents and nothing else.

How this works
- Every team writes its documents its own way: one long specification, a file per feature, a folder per module. Find how this source is built before you cut it.
- The harness checks what you hand in against what you looked at. A result that starts with "Refused" says what is wrong: fix that, and only that. A result that starts with "Warning" asks you once: the same call again confirms.
- Never guess what a document holds from its name: list its sections, or read it.

Method. Each step says when it is done.
1. Walk the tree. {{list_files_tool}} gives the folders and the documents of one folder, each with its title and its length; call it on each folder. Done when you know what every folder holds.
2. Get an idea of each document. {{list_sections_tool}} gives its headings without its text; {{read_section_tool}} and {{read_file_tool}} give the text, {{search_tool}} finds a word. Read what the headings do not tell. Done when you can say, for each document, what it is about.
3. Name the domains: the functional areas a user would name, such as orders, customers, billing — not the chapters of a template, such as scope or glossary.
4. Hand each domain in with {{write_domain_tool}}: its elements, then its file. Set aside with {{set_aside_tool}} what serves no functional area: a document, such as a change log, or a section, such as a glossary. A document you cut into sections is covered section by section: the harness names the sections still in no domain, and a section that holds others covers them. Done when the harness says the whole source is placed or set aside: answer with one sentence.

The grain of an element
- An element is something a test can aim at: a use case, a screen, a business rule or a small group of rules, a feature.
- A short document about one thing is one element: give its file alone. A long document about several things is cut: give one element per section that matters, with the number {{list_sections_tool}} gives.
- Neither a whole chapter that holds everything, nor a single sentence. When a document is organised by a template, cut it at the level where the functional subjects appear, and place each in the domain of its subject.

The file of a domain
- Markdown, under {{max_length}} characters, in English. Name every element of the domain between backticks, exactly as the harness names it: the path of a document, such as \`orders/place-order.md\`, or the path and the title of a section, such as \`specs.md § Place an order\`.
- Say what each element states that a test can verify: the rules, the values, the messages, the conditions. Say only what you read.

Keep with remember what the agents after you should know and no single document says, such as a rule that contradicts another or a term the team uses its own way. Not everything: a few facts that matter.`,
  variables: [
    "list_files_tool",
    "list_sections_tool",
    "read_section_tool",
    "read_file_tool",
    "search_tool",
    "write_domain_tool",
    "set_aside_tool",
    "max_length",
  ],
} as const satisfies PromptTemplate;

/**
 * System instructions of the agent that maps the documents of one source.
 *
 * @param sourceId - Identifier of the source, which names its tools.
 * @returns The instructions.
 */
export function documentCartographerInstructions(sourceId: string): string {
  const tool = (action: string) => scopedToolName(sourceId, action);
  return promptOf(DOCUMENT_CARTOGRAPHER_PROMPT, {
    list_files_tool: tool("list_files"),
    list_sections_tool: tool("list_sections"),
    read_section_tool: tool("read_section"),
    read_file_tool: tool("read_file"),
    search_tool: tool("search"),
    write_domain_tool: WRITE_DOMAIN_TOOL,
    set_aside_tool: SET_ASIDE_TOOL,
    max_length: String(MAX_DOMAIN_FILE_LENGTH),
  });
}

/**
 * Writes the request that starts the session that maps the documents of a source: what its root holds.
 *
 * @param sourceId - Identifier of the source.
 * @param files - The documents of the source.
 * @returns The message to send to the agent.
 */
export function documentMapRequest(sourceId: string, files: readonly DocumentFile[]): string {
  const direct = files.filter((file) => !file.path.includes("/"));
  const folders = new Map<string, number>();
  for (const file of files.filter((candidate) => candidate.path.includes("/"))) {
    const folder = file.path.split("/")[0]!;
    folders.set(folder, (folders.get(folder) ?? 0) + 1);
  }
  const line = (file: DocumentFile) =>
    `- ${file.path}${file.title === undefined ? "" : ` — ${file.title}`} (${file.headings} headings, ${file.chars} characters)`;
  const more = direct.length > MAX_LISTED ? [`- … and ${direct.length - MAX_LISTED} more: list them with ${scopedToolName(sourceId, "list_files")}.`] : [];
  return [
    `Map the ${files.length} ${files.length === 1 ? "document" : "documents"} of the source ${sourceId}.`,
    ...(folders.size === 0 ? [] : [`Folders of its root:\n${[...folders].map(([folder, count]) => `- ${folder}/ (${count} documents)`).join("\n")}`]),
    ...(direct.length === 0 ? [] : [`Documents of its root:\n${[...direct.slice(0, MAX_LISTED).map(line), ...more].join("\n")}`]),
    `Next: walk the tree, get an idea of each document, then hand each domain in with ${WRITE_DOMAIN_TOOL}.`,
  ].join("\n\n");
}
