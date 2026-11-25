import { Fragment, type ReactNode } from "react";
import type { Campaign, CampaignLaunchScope, CampaignProgress, CampaignResult, FinishedTest, TestLaunch } from "@open-qa-stack/domain/sessions";
import { campaignCounts } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { resultHref } from "../executions/executions-paths.ts";
import { VerdictBadge } from "../executions/verdicts.tsx";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { statusName } from "../i18n/vocabulary.ts";
import { hrefTo } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { CampaignComposer, type ComposerProps } from "./campaign-composer.tsx";
import { CampaignLifecycle } from "./campaign-lifecycle.tsx";
import { CampaignProgressCard } from "./campaign-progress.tsx";
import { campaignDays, campaignEnvironment } from "./campaign-text.ts";
import { CampaignStatusBadge } from "./campaign-status.tsx";
import { CampaignVerdictBadge } from "./campaign-verdict.tsx";
import { CAMPAIGNS_PATH } from "./campaigns-paths.ts";

/**
 * A change a person asks of a campaign: fix its tests, launch them all, those that failed or those not run, close it —
 * which asks to be confirmed — or give the closing up.
 */
export type CampaignGesture = "ready" | "launch" | "launch_failed" | "launch_not_run" | "close" | "confirm_close" | "cancel_close";

/** @returns The tests of a campaign a gesture launches: those that failed, those not run, or every one. */
export function launchScopeOf(gesture: CampaignGesture): CampaignLaunchScope | undefined {
  return gesture === "launch_failed" ? "failed" : gesture === "launch_not_run" ? "not_run" : undefined;
}

/** Where the gestures on a campaign stand: the one asked of the instance, a closing to confirm, and why the last one was refused. */
export interface GestureState {
  readonly pending?: CampaignGesture;
  readonly confirming?: boolean;
  readonly refusal?: string;
}

/** What the screen of a campaign needs. */
export interface CampaignScreenProps {
  readonly project: string;
  readonly id: string;
  readonly state: PolledState<CampaignProgress>;
  /** The launch of the tests of this campaign that runs now, with how far it went. */
  readonly launch?: TestLaunch;
  readonly gestures: GestureState;
  /** Asks for a change of the campaign. */
  readonly onGesture: (gesture: CampaignGesture) => void;
  /** The choice of its tests, for a planned campaign; none shows the tests it holds. */
  readonly composer?: ComposerProps;
}

/** The order a person reads the tests of a campaign in: what went wrong first, what was not run, then the others. */
const ORDER: readonly CampaignResult["verdict"][] = ["failed", "flaky", "not_run", "skipped", "passed"];

/** A test of a campaign as the launch that runs tells it: finished, with its verdict, or still to come. */
type LiveResult = CampaignResult & { readonly live?: FinishedTest | "running" };

/** The tests of a campaign, the failures first, each with what the launch that runs tells of it. */
function liveResults(results: readonly CampaignResult[], launch: TestLaunch | undefined): LiveResult[] {
  const ordered = results.toSorted((left, right) => ORDER.indexOf(left.verdict) - ORDER.indexOf(right.verdict));
  if (launch === undefined) return ordered;
  return ordered.map((result) => {
    if (!launch.paths.includes(result.path)) return result;
    const finished = launch.progress?.finished.find(({ path }) => path === result.path);
    return { ...result, live: finished ?? "running" };
  });
}

/** A test of a campaign with what came of it, which leads to its result when it ran. */
function ResultRow({ result }: { readonly result: LiveResult }): ReactNode {
  const { live } = result;
  const badge =
    live === "running" ? (
      <Badge tone="info">{t("campaign.running")}</Badge>
    ) : live !== undefined ? (
      <VerdictBadge verdict={live.verdict} />
    ) : result.verdict === "not_run" ? (
      <Badge tone="outline">{statusName("not_run")}</Badge>
    ) : (
      <VerdictBadge verdict={result.verdict} />
    );
  const when =
    live === "running" ? t("campaign.inLaunch") : live !== undefined ? t("campaign.justNow") : result.ranAt === undefined ? undefined : dateText(result.ranAt);
  const body = (
    <>
      <span className="campaign-verdict">{badge}</span>
      <div className="grow">
        <b title={result.path}>{result.title}</b>
        {when !== undefined && <div className="small muted">{when}</div>}
      </div>
    </>
  );
  return result.execution === undefined || live !== undefined ? (
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
  launch,
  gestures,
  onGesture,
  composer,
}: { readonly progress: CampaignProgress } & Omit<CampaignScreenProps, "project" | "id" | "state">): ReactNode {
  const { status } = progress.campaign;
  const counts = campaignCounts(progress.results);
  const busy = gestures.pending !== undefined;
  // A campaign becomes ready with the tests the instance keeps for it: some, and none left to keep.
  const unfixable = progress.campaign.tests.length === 0 || composer?.changed === true;
  // While a launch of it runs, the campaign takes no other launch, and is not closed: its results are not fixed yet.
  const waitsForTheLaunch = (gesture: CampaignGesture): boolean =>
    launch !== undefined && (gesture.startsWith("launch") || gesture === "close" || gesture === "confirm_close");
  const button = (gesture: CampaignGesture, label: string, kind = "btn"): ReactNode => (
    <button
      key={gesture}
      type="button"
      className={kind}
      disabled={busy || waitsForTheLaunch(gesture) || (gesture === "ready" && unfixable)}
      onClick={() => onGesture(gesture)}
    >
      {gestures.pending === gesture ? t("campaign.pending") : label}
    </button>
  );
  if (status === "planned") return button("ready", t("campaign.ready"), "btn primary");
  if (status === "ready") return button("launch", t("campaign.launch"), "btn primary");
  if (status === "closed") return undefined;
  if (gestures.confirming === true)
    return (
      <div className="campaign-confirm" role="group" aria-label={t("campaign.closeQuestion")}>
        <span className="small">{t("campaign.closeQuestion")}</span>
        {button("confirm_close", t("campaign.confirmClose"), "btn danger")}
        {button("cancel_close", t("campaign.cancel"))}
      </div>
    );
  return (
    <>
      {counts.failed > 0 && button("launch_failed", t("campaign.launchFailed", { count: counts.failed }), "btn primary")}
      {counts.not_run > 0 && button("launch_not_run", t("campaign.launchNotRun", { count: counts.not_run }), counts.failed > 0 ? "btn" : "btn primary")}
      {button("launch", t("campaign.relaunch"), counts.failed > 0 || counts.not_run > 0 ? "btn" : "btn primary")}
      {button("close", t("campaign.close"))}
    </>
  );
}

/** What was said of a campaign when it was planned: what it is for, its days, who answers for it; what was not said is left out. */
function Details({ campaign }: { readonly campaign: Campaign }): ReactNode {
  const said = [
    [t("campaigns.details.objective"), campaign.objective],
    [t("campaigns.details.days"), campaignDays(campaign)],
    [t("campaigns.details.owner"), campaign.owner],
  ] as const;
  return said.map(([name, value]) =>
    value === undefined ? null : (
      <Fragment key={name}>
        <dt>{name}</dt>
        <dd>{value}</dd>
      </Fragment>
    ),
  );
}

/** A campaign: where it is in its life, how far it went, its tests with what came of each, and what can be done with it now. */
export function CampaignScreen({ project, id, state, launch, gestures, onGesture, composer }: CampaignScreenProps): ReactNode {
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
  return (
    <Page
      crumbs={crumbs}
      title={
        <>
          {name} <CampaignStatusBadge status={campaign.status} />
          {campaign.status !== "planned" && (
            <>
              {" "}
              <CampaignVerdictBadge counts={campaignCounts(results)} />
            </>
          )}
        </>
      }
      actions={
        <Gestures
          progress={progress}
          {...(launch === undefined ? {} : { launch })}
          gestures={gestures}
          onGesture={onGesture}
          {...(composer === undefined ? {} : { composer })}
        />
      }
    >
      <CampaignLifecycle status={campaign.status} />
      <dl className="campaign-facts small">
        <dt>{t("campaign.environment")}</dt>
        <dd>{campaignEnvironment(campaign)}</dd>
        <Details campaign={campaign} />
        <dt>{t("campaign.created")}</dt>
        <dd>{dateText(campaign.createdAt)}</dd>
        {campaign.closedAt !== undefined && (
          <>
            <dt>{t("campaign.closed")}</dt>
            <dd>{dateText(campaign.closedAt)}</dd>
          </>
        )}
      </dl>
      {gestures.refusal !== undefined && (
        <p className="small campaign-refusal" role="alert">
          {gestures.refusal}
        </p>
      )}
      {campaign.status === "planned" && <p className="small muted">{t("campaign.plannedNote")}</p>}
      {campaign.status === "planned" && composer !== undefined ? (
        <CampaignComposer {...composer} />
      ) : results.length === 0 ? (
        <EmptyState title={t("campaign.noTest")}>{t("campaign.noTestNote")}</EmptyState>
      ) : (
        <>
          {campaign.status !== "planned" && <CampaignProgressCard counts={campaignCounts(results)} {...(launch === undefined ? {} : { launch })} />}
          <section className="card campaign-results" aria-label={t("campaign.tests")}>
            <div className="campaign-counts small">
              <b>{t("campaign.testCount", { count: results.length })}</b>
            </div>
            {liveResults(results, launch).map((result) => (
              <ResultRow key={`${result.path}:${result.title}`} result={result} />
            ))}
          </section>
        </>
      )}
    </Page>
  );
}
