/** The end of the name of a tool that drives the browser of an application, which the name starts with. */
export const BROWSER_TOOL = /_(goto|click|fill|select_option|check|snapshot|screenshot|requests|console)$/;

/**
 * Names the application a browser tool drives.
 *
 * @param tool - The name of a tool, such as `policy_management_goto`.
 * @returns The application, such as `policy-management`; `undefined` for a tool that drives no browser.
 */
export function applicationOf(tool: string): string | undefined {
  return BROWSER_TOOL.test(tool) ? tool.replace(BROWSER_TOOL, "").replace(/_/g, "-") : undefined;
}
