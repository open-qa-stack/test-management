import type { CampaignLaunchScope } from "@open-qa-stack/domain";
import type { Command } from "./command.ts";

/** What `oqas campaigns` is followed by, with the words each action takes after its campaign at least and at most. */
const CAMPAIGN_ACTIONS = { plan: [0, 0], show: [0, 0], ready: [0, 0], close: [0, 0], choose: [1, Infinity], launch: [0, 1] } as const;

/** What `oqas campaigns launch` launches of a campaign, by the word that says it. */
const SCOPES: Readonly<Record<string, CampaignLaunchScope>> = { failed: "failed", "not-run": "not_run" };

/** What `oqas campaigns` asks for, or why it is refused: the list, or what it does to one campaign. */
export function campaignsOf(
  words: readonly string[],
  options: { readonly environment: string | undefined; readonly brief: string | undefined; readonly follow: boolean },
): Command | string {
  const [action, campaign = "", ...rest] = words;
  const { environment, brief, follow } = options;
  if (brief !== undefined || follow) return "oqas campaigns acts on the campaigns: it takes no --brief nor --follow.";
  if ((environment !== undefined) !== (action === "plan"))
    return "oqas campaigns plan needs --environment, the environment its tests run against: it goes with plan alone.";
  if (action === undefined) return { name: "campaigns", action: "list" };
  const known = Object.hasOwn(CAMPAIGN_ACTIONS, action) ? (action as keyof typeof CAMPAIGN_ACTIONS) : undefined;
  const [least, most] = known === undefined ? [0, -1] : CAMPAIGN_ACTIONS[known];
  if (known === undefined || words.length < 2 || rest.length < least || rest.length > most)
    return "oqas campaigns takes nothing, plan then a name, show, ready or close then a campaign, choose then a campaign and its tests, or launch then a campaign and failed or not-run.";
  if (known === "plan") return { name: "campaigns", action: known, campaign, environment: environment! };
  if (known === "choose") return { name: "campaigns", action: known, campaign, paths: rest };
  if (known !== "launch") return { name: "campaigns", action: known, campaign };
  const [scope] = rest;
  if (scope === undefined) return { name: "campaigns", action: known, campaign };
  const only = SCOPES[scope];
  return only === undefined
    ? "oqas campaigns launch takes failed or not-run after the campaign, or nothing for every test."
    : { name: "campaigns", action: known, campaign, only };
}
