import type { FormEventHandler, ReactNode } from "react";
import type { LastVerdict, LaunchRequest, RepositoryTest } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { LEVELS, levelName, statusCount, statusName } from "../i18n/vocabulary.ts";
import { applicationName } from "../applications/application-names.ts";
import { hrefTo, withPanel, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { SidePanel } from "../ui/side-panel.tsx";
import { TestRelaunch, type RelaunchState } from "./test-relaunch.tsx";
import { TESTS_PATH, testHref } from "./tests-paths.ts";
import type { TestsState } from "./tests-state.ts";

/** What the person does on the screen of the tests. */
export interface TestsControls {
  /** Narrows the tests to the words of the search form. */
  readonly search: FormEventHandler<HTMLFormElement>;
}

/** What the screen of the tests is drawn from. */
export interface TestsScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** Where the console is: the tests, with the level and the words they are narrowed to. */
  readonly route: Route;
  readonly state: TestsState;
  readonly controls: TestsControls;
  /** What came of each test the last time it ran. */
  readonly verdicts?: readonly LastVerdict[];
  /** Where the relaunch of the tests that failed stands; none offers it. */
  readonly relaunch?: RelaunchState;
  /** Runs the files of the tests that failed again, against the environment chosen, if any. */
  readonly onRelaunch?: (where: Pick<LaunchRequest, "environment">) => void;
}

/** What the list keeps of the tests by what came of them last: those that failed, or those that passed. */
export type Outcome = "failed" | "passed";

/** How the address narrows the list: to a level, to what came of the tests, to the words of a search. */
export interface TestsFilter {
  readonly level?: string | undefined;
  readonly outcome?: string | undefined;
  readonly search?: string | undefined;
}

/**
 * What came of a test the last time it ran, among the verdicts of the instance.
 *
 * @param test - The test.
 * @param verdicts - What came of each test the last time it ran.
 * @returns Its verdict; none for a test that never ran.
 */
export function verdictOf(test: RepositoryTest, verdicts: readonly LastVerdict[]): LastVerdict["verdict"] | undefined {
  return verdicts.find((verdict) => verdict.path === test.path && verdict.title === test.title)?.verdict;
}

/** Whether a verdict is one the list keeps for an outcome: a failure, or a pass, flaky or not. */
function isOutcome(verdict: LastVerdict["verdict"] | undefined, outcome: Outcome): boolean {
  return outcome === "failed" ? verdict === "failed" : verdict === "passed" || verdict === "flaky";
}

/** Whether a test holds every word of a search, in its title, its path or its tags, case aside. */
function matches(test: RepositoryTest, search: string): boolean {
  const text = [test.title, test.path, ...test.tags].join(" ").toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => text.includes(word));
}

/**
 * The link to the screen narrowed to a level, to what came of the tests and to the words of a search.
 *
 * @param filter - The level, the outcome and the words; every test for what is left out, and for empty words.
 * @returns The fragment to put in an `href`.
 */
export function testsHref({ level, outcome, search }: TestsFilter = {}): string {
  return hrefTo(TESTS_PATH, {
    ...(level === undefined ? {} : { level }),
    ...(outcome === undefined ? {} : { outcome }),
    ...(search === undefined || search === "" ? {} : { q: search }),
  });
}

/** The filter of the outcomes: every test, those that failed last, those that passed, each with how many tests it holds. */
function OutcomeFilter({
  tests,
  verdicts,
  route,
}: {
  readonly tests: readonly RepositoryTest[];
  readonly verdicts: readonly LastVerdict[];
  readonly route: Route;
}): ReactNode {
  const { level, outcome: chosen, q: search } = route.query;
  const entries = [
    { outcome: undefined, label: t("tests.allOutcomes"), count: tests.length },
    ...(["failed", "passed"] as const).map((outcome) => ({
      outcome,
      label: t(`tests.outcomes.${outcome}`),
      count: tests.filter((test) => isOutcome(verdictOf(test, verdicts), outcome)).length,
    })),
  ];
  return (
    <nav className="tests-levels" aria-label={t("tests.outcomeFilter")}>
      {entries.map(({ outcome, label, count }) => (
        <a
          key={label}
          className={outcome === chosen ? "chip on" : outcome === "failed" ? "chip ko" : "chip"}
          href={testsHref({ level, outcome, search })}
          aria-current={outcome === chosen ? "page" : undefined}
        >
          {outcome === "failed" && outcome !== chosen && <Icon name="close" size={12} />}
          {label} <span className="muted">{count}</span>
        </a>
      ))}
    </nav>
  );
}

/** The levels of the pyramid, every level first, each with how many tests it holds. */
function levelsOf(tests: readonly RepositoryTest[]): readonly { readonly level: string | undefined; readonly label: string; readonly count: number }[] {
  return [
    { level: undefined, label: t("tests.allLevels"), count: tests.length },
    ...LEVELS.map((level) => ({ level, label: levelName(level), count: tests.filter((test) => test.level === level).length })),
  ];
}

/** The filter of the levels: every level, then each level of the pyramid with how many tests it holds; a phone opens it in a panel. */
function LevelFilter({ tests, route }: { readonly tests: readonly RepositoryTest[]; readonly route: Route }): ReactNode {
  const { level: chosen, outcome, q: search } = route.query;
  return (
    <nav className="tests-levels tests-levels-row" aria-label={t("tests.levelFilter")}>
      {levelsOf(tests).map(({ level, label, count }) => (
        <a
          key={label}
          className={level === chosen ? "chip on" : "chip"}
          href={testsHref({ level, outcome, search })}
          aria-current={level === chosen ? "page" : undefined}
        >
          {label} <span className="muted">{count}</span>
        </a>
      ))}
    </nav>
  );
}

/** The panel a phone chooses a level in: a row each, the level chosen marked, with how many tests it holds. */
function LevelPanel({ tests, route }: { readonly tests: readonly RepositoryTest[]; readonly route: Route }): ReactNode {
  const { level: chosen, outcome, q: search } = route.query;
  return (
    <SidePanel id="tests-levels" title={t("tests.filterTitle")} close={withPanel(route)}>
      <h3 className="grp">{t("tests.levelHeading")}</h3>
      <nav className="tests-level-rows" aria-label={t("tests.levelFilter")}>
        {levelsOf(tests).map(({ level, label, count }) => (
          <a
            key={label}
            className={level === chosen ? "row tests-level-row on" : "row tests-level-row"}
            href={testsHref({ level, outcome, search })}
            aria-current={level === chosen ? "page" : undefined}
          >
            <span className="tests-radio" aria-hidden="true" />
            <span className="grow">{label}</span>
            <span className="small muted">{count}</span>
          </a>
        ))}
      </nav>
    </SidePanel>
  );
}

/**
 * A test in the list, which leads to its screen: what came of it last, its title over its domain and functionality,
 * then its level, its kind, its steps and its last verdict in words; a test that failed in the tone of the failure.
 */
function TestRow({ test, verdict }: { readonly test: RepositoryTest; readonly verdict: LastVerdict["verdict"] | undefined }): ReactNode {
  const where = [test.domain, test.feature].filter((part) => part !== undefined).join(" › ");
  const failed = verdict === "failed";
  return (
    <a className={failed ? "row tests-row failed" : "row tests-row"} href={testHref(test.path)}>
      <span className={`tests-mark ${verdict ?? "never"}`} role="img" aria-label={verdict === undefined ? t("test.neverRun") : statusName(verdict)}>
        {verdict !== undefined && <Icon name={failed ? "close" : "check"} size={12} />}
      </span>
      <div className="grow tests-row-text">
        <b>{test.title}</b>
        {where !== "" && <div className="small muted mono">{where}</div>}
      </div>
      <span className="tests-row-facts small muted">
        {test.level !== undefined && <span>{levelName(test.level)}</span>}
        {test.kind === "visual" && <Badge tone="outline">{t("tests.visual")}</Badge>}
        <span>{t("tests.steps", { count: test.steps.length })}</span>
        <span className={failed ? "tests-verdict ko" : "tests-verdict"}>{verdict === undefined ? t("test.neverRun") : statusName(verdict)}</span>
      </span>
      <Icon name="chevron" />
    </a>
  );
}

/** The tests of each application they act on, in the order of their first appearance: a test that crosses applications is under its first. */
function byApplication(tests: readonly RepositoryTest[]): ReadonlyMap<string, readonly RepositoryTest[]> {
  const groups = new Map<string, RepositoryTest[]>();
  for (const test of tests) {
    const application = test.applications[0] ?? "";
    groups.set(application, [...(groups.get(application) ?? []), test]);
  }
  return groups;
}

/**
 * The screen of the tests of the repository: every test, application by application, each with what came of it last,
 * narrowed to what came of them, to a level and to the words of a search that the address keeps, so that a person
 * shares what they look at. Its action runs the files of the tests that failed again.
 *
 * @param props - The name of the project, where the console is, what the instance told, and the relaunch of the failures.
 * @returns The screen.
 */
export function TestsScreen({ project, route, state, controls, verdicts = [], relaunch, onRelaunch }: TestsScreenProps): ReactNode {
  const title = t("tests.title");
  const { tests } = state;
  const { level, outcome, q: search = "" } = route.query;
  const kept = outcome === "failed" || outcome === "passed" ? outcome : undefined;
  const shown = (tests ?? []).filter(
    (test) => (level === undefined || test.level === level) && (kept === undefined || isOutcome(verdictOf(test, verdicts), kept)) && matches(test, search),
  );
  const failing = (tests ?? []).filter((test) => verdictOf(test, verdicts) === "failed").length;
  return (
    <Page
      crumbs={[{ label: project }, { label: title }]}
      title={title}
      {...(tests === undefined || tests.length === 0 ? {} : { hint: t("tests.lead", { count: tests.length }) })}
      {...(failing === 0 || relaunch === undefined || onRelaunch === undefined
        ? {}
        : {
            actions: (
              <TestRelaunch
                state={relaunch}
                onLaunch={onRelaunch}
                several={{ label: t("tests.relaunchFailures", { count: failing }), note: t("tests.relaunchFailuresNote") }}
              />
            ),
          })}
    >
      {tests === undefined ? (
        <EmptyState title={t("tests.reading")}>
          <span role="status">{state.unread ?? t("tests.readingNote")}</span>
        </EmptyState>
      ) : tests.length === 0 ? (
        <EmptyState title={t("tests.none")}>{t("tests.noneNote")}</EmptyState>
      ) : (
        <>
          <form className="tests-search" role="search" onSubmit={controls.search}>
            <input type="search" name="q" defaultValue={search} aria-label={t("tests.search")} placeholder={t("tests.search")} />
          </form>
          <div className="tests-filters">
            <OutcomeFilter tests={tests} verdicts={verdicts} route={route} />
            <a className="btn tests-filter-open" href={withPanel(route, "levels")} aria-label={t("tests.filterTitle")}>
              <Icon name="filter" />
            </a>
          </div>
          <LevelFilter tests={tests} route={route} />
          {shown.length === 0 ? (
            <EmptyState title={t("tests.noMatch")}>{t("tests.noMatchNote")}</EmptyState>
          ) : (
            [...byApplication(shown)].map(([application, grouped], rank) => {
              const failed = grouped.filter((test) => verdictOf(test, verdicts) === "failed").length;
              return (
                <details key={application} className="card tests-group" open={failed > 0 || rank === 0}>
                  <summary className="tests-group-head">
                    <Icon name="chevron" />
                    <b>{application === "" ? t("tests.noApplication") : applicationName(application)}</b>
                    <span className="small muted grow">{t("tests.count", { count: grouped.length })}</span>
                    {failed > 0 && <Badge tone="ko">{statusCount("failed", failed)}</Badge>}
                  </summary>
                  {grouped.map((test) => (
                    <TestRow key={`${test.path}\n${test.title}`} test={test} verdict={verdictOf(test, verdicts)} />
                  ))}
                </details>
              );
            })
          )}
        </>
      )}
      {tests !== undefined && route.query["panel"] === "levels" && <LevelPanel tests={tests} route={route} />}
    </Page>
  );
}
