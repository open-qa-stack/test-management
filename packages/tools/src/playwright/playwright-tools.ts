import type { ToolDefinition } from "@open-qa-stack/domain";
import type { PlaywrightReference, ReferenceMember } from "./playwright-reference.ts";

/** Name of the tool that finds members of the API of Playwright by words. */
export const PLAYWRIGHT_SEARCH_TOOL = "playwright_search";
/** Name of the tool that gives what the reference says of one member. */
export const PLAYWRIGHT_READ_TOOL = "playwright_read";
/** Most members a search returns. */
export const MAX_FOUND_MEMBERS = 15;
/** Longest text a read returns, in characters. */
export const MAX_MEMBER_CHARS = 8000;

/**
 * The tools that read the reference of the API of Playwright, at the version the test repository installs.
 *
 * @remarks
 * `playwright_search` finds the members that echo words, each with the first sentence of what the reference
 * says of it; `playwright_read` gives one member whole: its description, how it is declared, and each of its
 * options. An agent that writes or reviews a test checks there what a method does and whether it exists,
 * instead of relying on what it remembers of another version.
 *
 * @param reference - The reference.
 * @returns The two tools.
 */
export function playwrightTools(reference: PlaywrightReference): ToolDefinition[] {
  const version = reference.version === undefined ? "the version installed" : `version ${reference.version}, the one installed`;
  return [
    {
      name: PLAYWRIGHT_SEARCH_TOOL,
      description: `Finds members of the API of Playwright (${version}) by words, such as "filter visible" or "toBeVisible": each with its name and what it does, in a sentence. Read one with ${PLAYWRIGHT_READ_TOOL}.`,
      parameters: { type: "object", properties: { query: { type: "string", minLength: 1 } }, required: ["query"], additionalProperties: false },
      execute: async (args) => {
        const { query } = args as { query: string };
        const found = reference.search(query, MAX_FOUND_MEMBERS);
        if (found.length === 0) return `Nothing of the API of Playwright (${version}) echoes "${query}". Try other words, such as the name of a method.`;
        return found.map((member) => `- ${member.name} — ${firstSentence(member)}`).join("\n");
      },
    },
    {
      name: PLAYWRIGHT_READ_TOOL,
      description: `Gives what the reference of Playwright (${version}) says of one member of its API, such as Locator.filter or LocatorAssertions.toBeVisible: what it does, how it is declared, and each of its options. A member it does not have does not exist in this version.`,
      parameters: { type: "object", properties: { member: { type: "string", minLength: 1 } }, required: ["member"], additionalProperties: false },
      execute: async (args) => {
        const { member: name } = args as { member: string };
        const member = reference.member(name);
        if (member === undefined) {
          const close = reference.search(name, 5).map((other) => other.name);
          return { error: `The API of Playwright (${version}) has no member ${name}.${close.length === 0 ? "" : ` Close to it: ${close.join(", ")}.`}` };
        }
        const text = `${member.name}\n\n${member.description}\n\n${member.signature}`;
        return text.length <= MAX_MEMBER_CHARS ? text : `${text.slice(0, MAX_MEMBER_CHARS)}\n\n[Cut at ${MAX_MEMBER_CHARS} of ${text.length} characters.]`;
      },
    },
  ];
}

/** What the reference says first of a member, on one line. */
function firstSentence(member: ReferenceMember): string {
  const line = member.description.replace(/\s+/g, " ").trim();
  const end = line.search(/\.(\s|$)/);
  return end === -1 ? line : line.slice(0, end + 1);
}
