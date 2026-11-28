import type { FormEventHandler, ReactNode } from "react";
import type { CampaignList, CampaignOverview } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { statusCount } from "../i18n/vocabulary.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { CampaignBar, ranOf } from "./campaign-progress.tsx";
import { campaignDays, campaignEnvironment } from "./campaign-text.ts";
import { CampaignStatusBadge } from "./campaign-status.tsx";
import { CampaignVerdictBadge } from "./campaign-verdict.tsx";
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
  /** How many tests the repository holds, which a campaign is chosen among; `undefined` until the instance said. */
  readonly tests: number | undefined;
  readonly planning: PlanningState;
  /** Plans the campaign the form describes. */
  readonly onPlan: FormEventHandler<HTMLFormElement>;
}

/** What the form that plans a campaign needs, and whether the project has none yet. */
type PlanFormProps = Pick<CampaignsScreenProps, "environments" | "planning" | "onPlan"> & { readonly first: boolean };

/** The form that plans a campaign: its name and its environment, and what may be said of it, folded; its tests are chosen next. */
function PlanForm({ environments, planning, onPlan, first }: PlanFormProps): ReactNode {
  return (
    <form className="card campaign-plan" onSubmit={onPlan}>
      <div className="campaign-plan-head">
        <h2 className="campaign-plan-title">{t("campaigns.plan.title")}</h2>
        {first && <p className="small muted">{t("campaigns.plan.none")}</p>}
      </div>
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
      <details className="campaign-more">
        <summary>
          <Icon name="chevron" size={12} />
          {t("campaigns.plan.more")}
        </summary>
        <label className="campaign-field">
          <span>{t("campaigns.details.objective")}</span>
          <input name="objective" maxLength={500} />
        </label>
        <label className="campaign-field">
          <span>{t("campaigns.details.targetVersion")}</span>
          <input name="targetVersion" maxLength={500} placeholder="4.2" />
        </label>
        <label className="campaign-field">
          <span>{t("campaigns.details.startsOn")}</span>
          <input name="startsOn" type="date" />
        </label>
        <label className="campaign-field">
          <span>{t("campaigns.details.endsOn")}</span>
          <input name="endsOn" type="date" />
        </label>
        <label className="campaign-field">
          <span>{t("campaigns.details.owner")}</span>
          <input name="owner" maxLength={500} />
        </label>
      </details>
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
  return (
    <a className="row campaign-row" href={campaignHref(campaign.id)}>
      <div className="grow">
        <b>{campaign.name}</b>
        <div className="small muted">
          {[campaignEnvironment(campaign), campaignDays(campaign), campaign.owner].filter((part) => part !== undefined).join(" · ")}
        </div>
        <div className="campaign-row-progress small muted">
          <CampaignBar counts={campaign.counts} />
          {campaign.status === "planned" ? t("campaigns.chosen", { count: total }) : t("campaign.ran", { ran: ranOf(campaign.counts), total })}
          {campaign.counts.failed > 0 && <span className="verdict-words failed"> · {statusCount("failed", campaign.counts.failed)}</span>}
        </div>
      </div>
      <div className="campaign-row-side">
        <span className="campaign-row-badges">
          <CampaignStatusBadge status={campaign.status} />
          {campaign.status !== "planned" && <CampaignVerdictBadge counts={campaign.counts} />}
        </span>
        <span className="small muted">{dateText(campaign.createdAt)}</span>
      </div>
    </a>
  );
}

/** How a campaign is made, in three steps, beside the form that plans the first. */
function PlanSteps({ tests }: Pick<CampaignsScreenProps, "tests">): ReactNode {
  const steps = [
    ["form", t("campaigns.steps.form.note")],
    ["tests", tests === undefined ? t("campaigns.steps.tests.note") : t("campaigns.steps.tests.count", { count: tests })],
    ["ready", t("campaigns.steps.ready.note")],
  ] as const;
  return (
    <ol className="campaign-steps" aria-label={t("campaigns.steps.label")}>
      {steps.map(([step, note], index) => (
        <li key={step} aria-current={index === 0 ? "step" : undefined}>
          <span className="campaign-step-number">{index + 1}</span>
          <span className="campaign-step-text">
            <b>{t(`campaigns.steps.${step}.title`)}</b>
            <span>{note}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The campaigns of the project, the latest planned first, beside the form that plans another; the steps of one before the first. */
export function CampaignsScreen({ project, state, environments, tests, planning, onPlan }: CampaignsScreenProps): ReactNode {
  const title = t("campaigns.title");
  const list = state.value;
  return (
    <Page crumbs={[{ label: project }, { label: title }]} title={title} hint={t("campaigns.lead")}>
      <div className="campaigns-layout">
        <PlanForm environments={environments} planning={planning} onPlan={onPlan} first={list?.items.length === 0} />
        {list === undefined ? (
          <EmptyState title={t("campaigns.reading")}>
            <span role="status">{state.unread ?? t("campaigns.readingNote")}</span>
          </EmptyState>
        ) : list.items.length === 0 ? (
          <PlanSteps tests={tests} />
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
