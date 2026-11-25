import type { CampaignDetails } from "@open-qa-stack/domain";

/** The options that say what a campaign is, as they are typed. */
export interface DetailOptions {
  readonly objective?: string;
  readonly target?: string;
  readonly from?: string;
  readonly until?: string;
  readonly owner?: string;
}

/** What the options say of a campaign; `undefined` when they say nothing of it. */
export function detailsOf({ objective, target, from, until, owner }: DetailOptions): CampaignDetails | undefined {
  const details: CampaignDetails = {
    ...(objective === undefined ? {} : { objective }),
    ...(target === undefined ? {} : { targetVersion: target }),
    ...(from === undefined ? {} : { startsOn: from }),
    ...(until === undefined ? {} : { endsOn: until }),
    ...(owner === undefined ? {} : { owner }),
  };
  return Object.keys(details).length === 0 ? undefined : details;
}
