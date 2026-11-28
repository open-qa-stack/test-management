import type { FormEventHandler, ReactNode } from "react";
import type { LastVerdict, LaunchRequest, RepositoryTest } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { LEVELS, levelName, statusCount, statusName } from "../i18n/vocabulary.ts";
import { applicationName } from "../applications/application-names.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
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
          {outcome === "failed" && <Icon name="close" size={12} />}
          {label} <span className="muted">{count}</span>
        </a>
      ))}
    </nav>
  );
}

/** The filter of the levels: every level, then each level of the pyramid with how many tests it holds. */
function LevelFilter({ tests, route }: { readonly tests: readonly RepositoryTest[]; readonly route: Route }): ReactNode {
  const { level: chosen, outcome, q: search } = route.query;
  const entries = [
    { level: undefined, label: t("tests.allLevels"), count: tests.length },
    ...LEVELS.map((level) => ({ level, label: levelName(level), count: tests.filter((test) => test.level === level).length })),
  ];
  return (
    <nav className="tests-levels" aria-label={t("tests.levelFilter")}>
      {entries.map(({ level, label, count }) => (
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
      <div className="grow">
        <b>{test.title}</b>
        {where !== "" && <div className="small muted mono">{where}</div>}
      </div>
      {test.level !== undefined && <span className="small muted">{levelName(test.level)}</span>}
      {test.kind === "visual" && <Badge tone="outline">{t("tests.visual")}</Badge>}
      <span className="small muted">{t("tests.steps", { count: test.steps.length })}</span>
      <span className={failed ? "small tests-verdict ko" : "small muted tests-verdict"}>
        {verdict === undefined ? t("test.neverRun") : statusName(verdict)}
      </span>
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
          <OutcomeFilter tests={tests} verdicts={verdicts} route={route} />
          <LevelFilter tests={tests} route={route} />
          {shown.length === 0 ? (
            <EmptyState title={t("tests.noMatch")}>{t("tests.noMatchNote")}</EmptyState>
          ) : (
            [...byApplication(shown)].map(([application, grouped]) => {
              const failed = grouped.filter((test) => verdictOf(test, verdicts) === "failed").length;
              return (
                <Card
                  key={application}
                  title={application === "" ? t("tests.noApplication") : applicationName(application)}
                  hint={t("tests.count", { count: grouped.length })}
                  {...(failed === 0 ? {} : { aside: <Badge tone="ko">{statusCount("failed", failed)}</Badge> })}
                >
                  {grouped.map((test) => (
                    <TestRow key={`${test.path}\n${test.title}`} test={test} verdict={verdictOf(test, verdicts)} />
                  ))}
                </Card>
              );
            })
          )}
        </>
      )}
    </Page>
  );
}
