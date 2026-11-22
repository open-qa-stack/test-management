import type { FormEventHandler, ReactNode } from "react";
import type { RepositoryTest } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { Badge } from "../ui/badge.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page } from "../ui/page.tsx";
import { TESTS_PATH, testHref } from "./tests-paths.ts";
import type { TestsState } from "./tests-state.ts";

/** The levels of the pyramid of tests, from its base to its top, in which order the filter offers them. */
const LEVELS = ["smoke", "functional", "business", "cross-application", "end-to-end"] as const;

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
 * The level of a test in the words of the person.
 *
 * @param level - The level its tag gives.
 * @returns Its words; the tag as it is for a level the console does not know.
 */
export function levelText(level: string): string {
  return (LEVELS as readonly string[]).includes(level) ? t(`tests.levels.${level as (typeof LEVELS)[number]}`) : level;
}

/**
 * The link to the screen narrowed to a level, or to every level, and to the words of a search.
 *
 * @param level - The level; every level when none is given.
 * @param search - The words of the search; none when none is given or they are empty.
 * @returns The fragment to put in an `href`.
 */
export function levelHref(level: string | undefined, search: string | undefined): string {
  if (search === "") return levelHref(level, undefined);
  return hrefTo(TESTS_PATH, { ...(level === undefined ? {} : { level }), ...(search === undefined ? {} : { q: search }) });
}

/** The filter of the levels: every level, then each level of the pyramid with how many tests it holds. */
function LevelFilter({ tests, route }: { readonly tests: readonly RepositoryTest[]; readonly route: Route }): ReactNode {
  const { level: chosen, q: search } = route.query;
  const entries = [
    { level: undefined, label: t("tests.allLevels"), count: tests.length },
    ...LEVELS.map((level) => ({ level, label: levelText(level), count: tests.filter((test) => test.level === level).length })),
  ];
  return (
    <nav className="tests-levels" aria-label={t("tests.levelFilter")}>
      {entries.map(({ level, label, count }) => (
        <a key={label} className={level === chosen ? "chip on" : "chip"} href={levelHref(level, search)} aria-current={level === chosen ? "page" : undefined}>
          {label} <span className="muted">{count}</span>
        </a>
      ))}
    </nav>
  );
}

/** A test in the list, which leads to its screen: its title, then its level, its kind, its domain and functionality, and its steps. */
function TestRow({ test }: { readonly test: RepositoryTest }): ReactNode {
  const where = [test.domain, test.feature].filter((part) => part !== undefined).join(" › ");
  return (
    <a className="row tests-row" href={testHref(test.path)}>
      <div className="grow">
        <b>{test.title}</b>
      </div>
      {where !== "" && <span className="small muted">{where}</span>}
      {test.level !== undefined && <Badge tone="outline">{levelText(test.level)}</Badge>}
      {test.kind === "visual" && <Badge tone="outline">{t("tests.visual")}</Badge>}
      <span className="small muted">{t("tests.steps", { count: test.steps.length })}</span>
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
 * The screen of the tests of the repository: every test, application by application, narrowed to a level and to the
 * words of a search that the address keeps, so that a person shares what they look at.
 *
 * @param props - The name of the project, where the console is, and what the instance told.
 * @returns The screen.
 */
export function TestsScreen({ project, route, state, controls }: TestsScreenProps): ReactNode {
  const title = t("tests.title");
  const { tests } = state;
  const { level, q: search = "" } = route.query;
  const shown = (tests ?? []).filter((test) => (level === undefined || test.level === level) && matches(test, search));
  return (
    <Page
      crumbs={[{ label: project }, { label: title }]}
      title={title}
      {...(tests === undefined || tests.length === 0 ? {} : { hint: t("tests.lead", { count: tests.length }) })}
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
          <LevelFilter tests={tests} route={route} />
          {shown.length === 0 ? (
            <EmptyState title={t("tests.noMatch")}>{t("tests.noMatchNote")}</EmptyState>
          ) : (
            [...byApplication(shown)].map(([application, grouped]) => (
              <Card key={application} title={application === "" ? t("tests.noApplication") : application} hint={t("tests.count", { count: grouped.length })}>
                {grouped.map((test) => (
                  <TestRow key={`${test.path}\n${test.title}`} test={test} />
                ))}
              </Card>
            ))
          )}
        </>
      )}
    </Page>
  );
}
