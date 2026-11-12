import type { ToolDefinition } from "@open-qa-stack/domain";
import { documentSections } from "./document-sections.ts";
import { readRepositoryFile } from "./repository-file.ts";
import { knowledgeToolName } from "./tool-name.ts";

/**
 * The tools of a document knowledge source: list its sections, read one.
 *
 * @remarks
 * Neither tool takes a path: both read the one file the configuration declares, inside the test
 * repository.
 *
 * @param knowledgeId - Identifier of the knowledge source.
 * @param repositoryRoot - Absolute path of the test repository.
 * @param path - Path of the document, relative to the repository root.
 * @returns The two tools.
 */
export function documentTools(knowledgeId: string, repositoryRoot: string, path: string): ToolDefinition[] {
  const sections = async () => documentSections(await readRepositoryFile(repositoryRoot, path));
  return [
    {
      name: knowledgeToolName(knowledgeId, "list_sections"),
      description: `Lists the sections of the document ${knowledgeId}: number, level and title.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => (await sections()).map(({ number, level, title }) => ({ number, level, title })),
    },
    {
      name: knowledgeToolName(knowledgeId, "read_section"),
      description: `Returns the text of one section of the document ${knowledgeId}, by its number.`,
      parameters: { type: "object", properties: { number: { type: "integer", minimum: 1 } }, required: ["number"], additionalProperties: false },
      execute: async (args) => {
        const { number } = args as { number: number };
        const section = (await sections()).find((s) => s.number === number);
        return section?.text ?? { error: `The document has no section ${number}.` };
      },
    },
  ];
}
