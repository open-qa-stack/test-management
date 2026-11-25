import { hrefTo } from "../routing/route.ts";

/**
 * The link to the entry of the agent with a request already written, which the person sends.
 *
 * @param request - The request.
 * @returns The fragment to put in an `href`.
 */
export function agentHref(request: string): string {
  return hrefTo("/agent", { request });
}
