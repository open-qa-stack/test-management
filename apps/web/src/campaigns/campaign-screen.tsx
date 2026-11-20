import type { ReactNode } from "react";
import type { CampaignProgress, CampaignResult } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { resultHref } from "../executions/executions-paths.ts";
import { VerdictBadge } from "../executions/verdicts.tsx";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { CampaignStatusBadge } from "./campaign-status.tsx";
import { CAMPAIGNS_PATH } from "./campaigns-paths.ts";
import { hrefTo } from "../routing/route.ts";

/** A change a person asks of a campaign. */
export type CampaignGesture = "ready" | "launch" | "close";

/** Where the gestures on a campaign stand: the one asked of the instance, and why the last one was refused. */
export interface GestureState {
  readonly pending?: CampaignGesture;
  readonly refusal?: string;
}

/** What the screen of a campaign needs. */
export interface CampaignScreenProps {
  readonly project: string;
  readonly id: string;
  readonly state: PolledState<CampaignProgress>;
  /** Whether a launch of the tests of this campaign runs now. */
  readonly launching: boolean;
  readonly gestures: GestureState;
  /** Asks the instance for a change of the campaign. */
  readonly onGesture: (gesture: CampaignGesture) => void;
}

/** The verdicts a campaign counts, in the order they are told: what went wrong first. */
const COUNTED = ["failed", "flaky", "passed", "skipped", "not_run"] as const;

/** How many tests of a campaign have each verdict, those that have none left out. */
function countsText(results: readonly CampaignResult[]): string {
  return COUNTED.flatMap((verdict) => {
    const count = results.filter((result) => result.verdict === verdict).length;
    return count === 0 ? [] : [t(`campaign.counts.${verdict}`, { count })];
  }).join(" · ");
}

/** A test of a campaign with what came of it, which leads to its result when it ran. */
function ResultRow({ result }: { readonly result: CampaignResult }): ReactNode {
  const body = (
    <>
      {result.verdict === "not_run" ? <Badge tone="outline">{t("campaign.notRun")}</Badge> : <VerdictBadge verdict={result.verdict} />}
      <div className="grow">
        <b>{result.title}</b>
        <div className="small muted mono campaign-path">{result.path}</div>
      </div>
      {result.ranAt !== undefined && <span className="small muted">{dateText(result.ranAt)}</span>}
    </>
  );
  return result.execution === undefined ? (
    <div className="row campaign-result">{body}</div>
  ) : (
    <a className="row campaign-result" href={resultHref(result.execution, result.path)}>
      {body}
    </a>
  );
}

/** The gestures the state of a campaign allows, the one asked of the instance shown as pending. */
function Gestures({
  progress,
  launching,
  gestures,
  onGesture,
}: { readonly progress: CampaignProgress } & Omit<CampaignScreenProps, "project" | "id" | "state">): ReactNode {
  const { status } = progress.campaign;
  const button = (gesture: CampaignGesture, primary: boolean, label: string): ReactNode => (
    <button
      type="button"
      className={primary ? "btn primary" : "btn"}
      disabled={gestures.pending !== undefined || (gesture === "launch" && launching)}
      onClick={() => onGesture(gesture)}
    >
      {gestures.pending === gesture ? t("campaign.pending") : label}
    </button>
  );
  if (status === "planned") return button("ready", true, t("campaign.ready"));
  if (status === "ready") return button("launch", true, t("campaign.launch"));
  if (status === "closed") return undefined;
  return (
    <>
      {button("launch", true, t("campaign.relaunch"))}
      {button("close", false, t("campaign.close"))}
    </>
  );
}

/** A campaign: where it is in its life, its tests with what came of each, and what can be done with it now. */
export function CampaignScreen({ project, id, state, launching, gestures, onGesture }: CampaignScreenProps): ReactNode {
  const progress = state.value;
  const name = progress?.campaign.name ?? id;
  const crumbs = [{ label: project }, { label: t("campaigns.title"), href: hrefTo(CAMPAIGNS_PATH) }, { label: name }];
  if (progress === undefined)
    return (
      <Page crumbs={crumbs} title={name}>
        <EmptyState title={t("campaign.reading")}>
          <span role="status">{state.unread ?? t("campaign.readingNote")}</span>
        </EmptyState>
      </Page>
    );
  const { campaign, results } = progress;
  const tags = campaign.scope.tags.length === 0 ? t("campaigns.everyTest") : campaign.scope.tags.join(" ");
  return (
    <Page
      crumbs={crumbs}
      title={
        <>
          {name} <CampaignStatusBadge status={campaign.status} />
        </>
      }
      actions={<Gestures progress={progress} launching={launching} gestures={gestures} onGesture={onGesture} />}
    >
      <dl className="campaign-facts small">
        <dt>{t("campaign.environment")}</dt>
        <dd>{campaign.environment}</dd>
        <dt>{t("campaign.tags")}</dt>
        <dd className="mono">{tags}</dd>
        <dt>{t("campaign.created")}</dt>
        <dd>{dateText(campaign.createdAt)}</dd>
        {campaign.closedAt !== undefined && (
          <>
            <dt>{t("campaign.closed")}</dt>
            <dd>{dateText(campaign.closedAt)}</dd>
          </>
        )}
      </dl>
      <div role="status" className="small">
        {launching ? t("campaign.launching") : gestures.refusal !== undefined ? <span className="campaign-refusal">{gestures.refusal}</span> : undefined}
      </div>
      {campaign.status === "planned" && <p className="small muted">{t("campaign.plannedNote")}</p>}
      {results.length === 0 ? (
        <EmptyState title={t("campaign.noTest")}>{t("campaign.noTestNote")}</EmptyState>
      ) : (
        <section className="card campaign-results" aria-label={t("campaign.tests")}>
          <div className="campaign-counts small">
            <b>{t("campaign.testCount", { count: results.length })}</b> · {countsText(results)}
          </div>
          {results.map((result) => (
            <ResultRow key={`${result.path}:${result.title}`} result={result} />
          ))}
        </section>
      )}
    </Page>
  );
}
