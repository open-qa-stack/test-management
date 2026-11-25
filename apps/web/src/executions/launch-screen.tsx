import type { ReactNode } from "react";
import type { CampaignOverview, LaunchState, TestLaunch } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../api/polled-state.ts";
import { campaignHref } from "../campaigns/campaigns-paths.ts";
import { dateText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { testHref } from "../tests/tests-paths.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { launchText } from "./execution-text.ts";
import { EXECUTIONS_PATH, executionHref } from "./executions-paths.ts";
import { LaunchAdvance } from "./launch-advance.tsx";
import { failuresFirst, VerdictBadge, VerdictCounts } from "./verdicts.tsx";

/** What the screen of the execution that runs is drawn from. */
export interface LaunchScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** What the instance told of the launches. */
  readonly state: PolledState<LaunchState>;
  /** The campaigns of the project, which name the one a launch runs for. */
  readonly campaigns: readonly CampaignOverview[];
}

/** A launch that runs: where from, how far it went, then the tests it finished, the failures first, each leading to its card. */
function Running({ launch, campaigns }: { readonly launch: TestLaunch; readonly campaigns: readonly CampaignOverview[] }): ReactNode {
  const finished = failuresFirst(launch.progress?.finished ?? []);
  return (
    <>
      <Card>
        <div className="row exec-summary">
          <Badge tone="info">{t("running.badge")}</Badge>
          <LaunchAdvance launch={launch} />
          <span className="exec-counts">
            <VerdictCounts results={finished} />
          </span>
          <span className="grow small muted">
            {launch.campaign === undefined ? launchText(launch, campaigns) : <a href={campaignHref(launch.campaign)}>{launchText(launch, campaigns)}</a>}
          </span>
        </div>
      </Card>
      {finished.length > 0 && (
        <Card title={t("running.finished")} hint={t("tests.count", { count: finished.length })}>
          {finished.map(({ path, title, verdict }, rank) => (
            <a key={rank} className="row tests-row" href={testHref(path)}>
              <VerdictBadge verdict={verdict} />
              <b className="grow">{title}</b>
            </a>
          ))}
        </Card>
      )}
    </>
  );
}

/** That no launch runs: what the last one kept, or why it kept nothing. */
function Ended({ last }: Pick<LaunchState, "last">): ReactNode {
  return (
    <EmptyState title={t("running.none")}>
      {last?.execution === undefined ? (last?.failure ?? t("running.noneNote")) : <a href={executionHref(last.execution)}>{t("running.last")} →</a>}
    </EmptyState>
  );
}

/**
 * The screen of the execution that runs: how far it went and what came of each test it finished, until it ends.
 *
 * @param props - The name of the project, what the instance told of the launches, and the campaigns.
 * @returns The screen.
 */
export function LaunchScreen({ project, state, campaigns }: LaunchScreenProps): ReactNode {
  const launch = state.value?.running;
  const title = launch === undefined ? t("running.title") : t("running.since", { date: dateText(launch.startedAt) });
  return (
    <Page crumbs={[{ label: project }, { label: t("executions.title"), href: hrefTo(EXECUTIONS_PATH) }, { label: t("running.title") }]} title={title}>
      {state.value === undefined ? (
        <EmptyState title={t("execution.reading")}>
          <span role="status">{state.unread ?? t("execution.readingNote")}</span>
        </EmptyState>
      ) : launch === undefined ? (
        <Ended {...state.value} />
      ) : (
        <Running launch={launch} campaigns={campaigns} />
      )}
    </Page>
  );
}
