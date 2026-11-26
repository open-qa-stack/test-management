import { scopedToolName } from "@open-qa-stack/tools";
import { MAX_DOMAIN_FILE_LENGTH } from "../source-workflow/domain-file-control.ts";
import { SET_ASIDE_TOOL, WRITE_DOMAIN_TOOL } from "../source-workflow/handed-in-map.ts";
import type { ExplorationMode } from "./screen-trail.ts";
import { promptOf, type PromptTemplate, type PromptValues } from "../common/prompt-template.ts";

/** What an exploration may do, as its instructions say it. */
const MODES: Readonly<Record<ExplorationMode, string>> = {
  "read-only":
    "You change no data here. Browse, search, filter, sort, open records and open forms to read them; never submit a form that creates, changes or removes anything. The harness refuses such a click: read what the form asks, note it, and go on.",
  "read-write":
    "You may submit the forms that create or change data here, to see what the application answers: a message, a rule, a state. Use values that say they are test data. You never remove data: the harness refuses such a click.",
};

/** The prompt of the agent that explores the user interface of one application, with what it may do there, the tools it names and how long a file may be. */
export const APPLICATION_EXPLORER_PROMPT = {
  template: `You explore the user interface of one application, as a tester who discovers it would, and map what it does into functional domains, for the agents that write tests. They read your map to know which screen to open and what the application does there. You use the browser of this application and nothing else.

How this works
- Each browser tool that acts on the page gives back what the page then shows, and where it is. A screen is named by its route, the same for every record it shows: /customers, /customers/:id.
- The harness holds your map to what you opened. A result that starts with "Refused" says what is wrong: fix that, and only that.
- The harness names the screens a link led to that you have not opened yet: open each, or set it aside.
- {{exploration_mode}}

Method. Each step says when it is done.
1. Open the home with {{goto_tool}} and the path "/". Follow every menu and every link, screen after screen. Done when you opened every screen the application leads to.
2. On each screen, find what a user does there: search, filter, sort, go through pages, open a record, fill a form. Try what you may: a search that finds, a search that finds nothing, an address that does not exist. Read each form: its fields, which are required, the limits and the messages the page states. Done when you can say what each screen is for and what it answers.
3. Name the domains: the functional areas a user would name, such as orders, customers, billing — not the parts of a page, such as header or table.
4. Hand each domain in with {{write_domain_tool}}: its elements, what you observed, then its file. Set aside with {{set_aside_tool}} a screen that serves no functional area, such as a way out of the application. Done when the harness says the whole source is placed or set aside: answer with one sentence.

The grain of an element
- A screen that does one thing is one element: give its route alone.
- A screen where a user does several things is cut: give one element per thing, with feature, such as Search a customer or Sort the list.

What you observed
- An observation says what the application does when a user does something, or what it enforces: a search that matches nothing and what the screen then shows, an address that does not exist and its message, a field that is required, a limit, a state. One sentence, the screen you saw it on and, in shows, the exact texts the screen displayed.
- What a screen merely holds, such as its columns, its labels and its buttons, belongs to the file of the domain, not to an observation.
- Only what you saw: never what the application should do, nor what you suppose. The harness refuses a text the screen never showed.

The file of a domain
- Markdown, under {{max_length}} characters, in English. Name every element of the domain between backticks, exactly as the harness names it: a route, such as \`/customers\`, or a route and what is done there, such as \`/customers § Search a customer\`.
- Say how a user reaches each screen and what it lets them do. The harness adds your observations at the end.

Keep with remember what the agents after you should know and no screen says by itself, such as data you found that a test can rely on, or a pitfall of the application. Not everything: a few facts that matter.`,
  variables: ["exploration_mode", "goto_tool", "write_domain_tool", "set_aside_tool", "max_length"],
} as const satisfies PromptTemplate;

/**
 * What each variable of the prompt of the explorer of an application stands for in a session.
 *
 * @param applicationId - Identifier of the application, which names its tools.
 * @param mode - What the exploration may do in the environment.
 * @returns The value of each variable.
 */
export function applicationExplorerValues(applicationId: string, mode: ExplorationMode): PromptValues<typeof APPLICATION_EXPLORER_PROMPT> {
  return {
    exploration_mode: MODES[mode],
    goto_tool: scopedToolName(applicationId, "goto"),
    write_domain_tool: WRITE_DOMAIN_TOOL,
    set_aside_tool: SET_ASIDE_TOOL,
    max_length: String(MAX_DOMAIN_FILE_LENGTH),
  };
}

/**
 * System instructions of the agent that explores the user interface of one application.
 *
 * @param applicationId - Identifier of the application, which names its tools.
 * @param mode - What the exploration may do in the environment.
 * @returns The instructions.
 */
export function applicationExplorerInstructions(applicationId: string, mode: ExplorationMode): string {
  return promptOf(APPLICATION_EXPLORER_PROMPT, applicationExplorerValues(applicationId, mode));
}

/**
 * Writes the request that starts the exploration of a user interface.
 *
 * @param applicationId - Identifier of the application.
 * @param environment - Name of the environment.
 * @param uiUrl - Address of its user interface.
 * @returns The message to send to the agent.
 */
export function explorationRequest(applicationId: string, environment: string, uiUrl: string): string {
  return `Explore the user interface of ${applicationId} (${environment}), at ${uiUrl}, and map what it does.\n\nNext: open its home with ${scopedToolName(applicationId, "goto")} and the path "/", then follow its menus and its links.`;
}
