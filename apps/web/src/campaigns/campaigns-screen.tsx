import type { FormEventHandler, ReactNode } from "react";
import type { CampaignList, CampaignOverview } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { CampaignBar, ranOf } from "./campaign-progress.tsx";
import { CampaignStatusBadge } from "./campaign-status.tsx";
import { campaignHref } from "./campaigns-paths.ts";

/** Where the planning of a campaign stands: idle, asked of the instance, or refused, with why. */
export interface PlanningState {
  readonly pending: boolean;
  readonly refusal?: string;
}

/** What the screen of the campaigns needs. */
export interface CampaignsScreenProps {
  readonly project: string;
  readonly state: PolledState<CampaignList>;
  /** The environments the configuration in force declares, which a campaign runs against. */
  readonly environments: readonly string[];
  readonly planning: PlanningState;
  /** Plans the campaign the form describes. */
  readonly onPlan: FormEventHandler<HTMLFormElement>;
}

/** The form that plans a campaign: its name, its environment, and the tags of its scope. */
function PlanForm({ environments, planning, onPlan }: Pick<CampaignsScreenProps, "environments" | "planning" | "onPlan">): ReactNode {
  return (
    <form className="card campaign-plan" onSubmit={onPlan}>
      <h2 className="campaign-plan-title">{t("campaigns.plan.title")}</h2>
      <label className="campaign-field">
        <span>{t("campaigns.plan.name")}</span>
        <input name="name" required maxLength={200} placeholder={t("campaigns.plan.namePlaceholder")} />
      </label>
      <label className="campaign-field">
        <span>{t("campaigns.plan.environment")}</span>
        {environments.length === 0 ? (
          <input name="environment" required />
        ) : (
          <select name="environment" defaultValue={environments[0]}>
            {environments.map((environment) => (
              <option key={environment} value={environment}>
                {environment}
              </option>
            ))}
          </select>
        )}
      </label>
      <label className="campaign-field">
        <span>{t("campaigns.plan.tags")}</span>
        <input name="tags" placeholder="@p0 @p1" aria-describedby="campaign-tags-help" />
        <small id="campaign-tags-help" className="muted">
          {t("campaigns.plan.tagsHelp")}
        </small>
      </label>
      {planning.refusal !== undefined && (
        <p className="small campaign-refusal" role="alert">
          {planning.refusal}
        </p>
      )}
      <button className="btn primary" type="submit" disabled={planning.pending}>
        {planning.pending ? t("campaigns.plan.pending") : t("campaigns.plan.submit")}
      </button>
    </form>
  );
}

/** A campaign in the list, with how far it went, which opens it. */
function CampaignRow({ campaign }: { readonly campaign: CampaignOverview }): ReactNode {
  const total = ranOf(campaign.counts) + campaign.counts.not_run;
  const tags = campaign.scope.tags.length === 0 ? t("campaigns.everyTest") : campaign.scope.tags.join(" ");
  return (
    <a className="row campaign-row" href={campaignHref(campaign.id)}>
      <div className="grow">
        <b>{campaign.name}</b>
        <div className="small muted">
          {campaign.environment} · <span className="mono">{tags}</span>
        </div>
        <div className="campaign-row-progress small muted">
          <CampaignBar counts={campaign.counts} />
          {campaign.status === "planned" ? t("campaigns.taken", { count: total }) : t("campaign.ran", { ran: ranOf(campaign.counts), total })}
          {campaign.counts.failed > 0 && <span className="verdict-words failed"> · {t("campaign.counts.failed", { count: campaign.counts.failed })}</span>}
        </div>
      </div>
      <div className="campaign-row-side">
        <CampaignStatusBadge status={campaign.status} />
        <span className="small muted">{dateText(campaign.createdAt)}</span>
      </div>
    </a>
  );
}

/** The campaigns of the project, the latest planned first, beside the form that plans another. */
export function CampaignsScreen({ project, state, environments, planning, onPlan }: CampaignsScreenProps): ReactNode {
  const title = t("campaigns.title");
  const list = state.value;
  return (
    <Page crumbs={[{ label: project }, { label: title }]} title={title}>
      <p className="small muted">{t("campaigns.lead")}</p>
      <div className="campaigns-layout">
        <PlanForm environments={environments} planning={planning} onPlan={onPlan} />
        {list === undefined ? (
          <EmptyState title={t("campaigns.reading")}>
            <span role="status">{state.unread ?? t("campaigns.readingNote")}</span>
          </EmptyState>
        ) : list.items.length === 0 ? (
          <EmptyState title={t("campaigns.none")}>{t("campaigns.noneNote")}</EmptyState>
        ) : (
          <section className="card campaign-list" aria-label={title}>
            {list.items.map((campaign) => (
              <CampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </section>
        )}
      </div>
    </Page>
  );
}
