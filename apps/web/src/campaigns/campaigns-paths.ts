import type { ConfigurationView } from "@open-qa-stack/domain/sessions";
import { hrefTo } from "../routing/route.ts";

/** Where the console lists the campaigns. */
export const CAMPAIGNS_PATH = "/campaigns";

/**
 * @param id - The identifier of a campaign.
 * @returns The address of the screen of the campaign, in the console.
 */
export function campaignHref(id: string): string {
  return hrefTo(`${CAMPAIGNS_PATH}/view`, { id });
}

/**
 * @param view - The configuration of the instance as it is now.
 * @returns The environments its revision in force declares, each once; none without a revision.
 */
export function declaredEnvironments({ revision }: Pick<ConfigurationView, "revision">): string[] {
  const names = revision?.document.applications.flatMap(({ environments }) => environments.map(({ name }) => name)) ?? [];
  return [...new Set(names)];
}

/**
 * Reads the tags a person typed, separated by spaces or commas.
 *
 * @param typed - What the person typed.
 * @returns Each tag once, with its `@` when it was left out.
 */
export function typedTags(typed: string): string[] {
  const words = typed.split(/[\s,]+/).filter((word) => word !== "");
  return [...new Set(words.map((word) => (word.startsWith("@") ? word : `@${word}`)))];
}
