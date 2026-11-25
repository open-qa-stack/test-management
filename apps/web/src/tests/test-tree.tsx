import type { ReactNode } from "react";
import type { RepositoryTest, LastVerdict } from "@open-qa-stack/domain/sessions";
import { VerdictBadge } from "../executions/verdicts.tsx";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { testHref } from "./tests-paths.ts";

/** What the tree of the tests is drawn from. */
export interface TestTreeProps {
  /** The path of the test whose card shows beside the tree. */
  readonly path: string;
  readonly tests: readonly RepositoryTest[];
  /** What came of the tests the last time each ran; none until it is read. */
  readonly verdicts: readonly LastVerdict[];
  /** Whether it shows only the tests whose last run failed. */
  readonly failing: boolean;
}

/** The tests of each domain, in the order of the domains, those without one last. */
function byDomain(tests: readonly RepositoryTest[]): readonly (readonly [string, readonly RepositoryTest[]])[] {
  const domains = [...new Set(tests.map(({ domain }) => domain ?? ""))];
  return domains
    .toSorted((left, right) => Number(left === "") - Number(right === "") || left.localeCompare(right))
    .map((domain) => [domain, tests.filter((test) => (test.domain ?? "") === domain)] as const);
}

/**
 * The tests of the repository by domain, with how many each holds, beside the card of one: every one, or those whose last
 * run failed. The domain of the test shown is unfolded; so is every domain of the failures.
 */
export function TestTree({ path, tests, verdicts, failing }: TestTreeProps): ReactNode {
  const last = new Map(verdicts.map((told) => [JSON.stringify([told.path, told.title]), told.verdict]));
  const verdictOf = (test: RepositoryTest) => last.get(JSON.stringify([test.path, test.title]));
  const failures = tests.filter((test) => verdictOf(test) === "failed");
  const shown = failing ? failures : tests;
  const views = [
    { label: t("test.tree.all"), count: tests.length, href: testHref(path), on: !failing },
    { label: t("test.tree.failing"), count: failures.length, href: testHref(path, "failing"), on: failing },
  ];
  return (
    <Card title={t("test.tree.title")}>
      <nav className="test-tree" aria-label={t("test.tree.title")}>
        <div className="tests-levels">
          {views.map(({ label, count, href, on }) => (
            <a key={href} className={on ? "chip on" : "chip"} href={href} aria-current={on ? "true" : undefined}>
              {label} · {count}
            </a>
          ))}
        </div>
        {shown.length === 0 && <p className="small muted">{t("test.tree.none")}</p>}
        {byDomain(shown).map(([domain, held]) => (
          <details key={domain} open={failing || held.some((test) => test.path === path)}>
            <summary>
              {domain === "" ? t("test.tree.noDomain") : domain} <span className="small muted">{held.length}</span>
            </summary>
            {held.map((test) => {
              const verdict = verdictOf(test);
              return (
                <a
                  key={`${test.path}\n${test.title}`}
                  className="test-tree-row small"
                  href={testHref(test.path, failing ? "failing" : undefined)}
                  aria-current={test.path === path ? "page" : undefined}
                >
                  <span className="grow">{test.title}</span>
                  {verdict !== undefined && verdict !== "passed" && <VerdictBadge verdict={verdict} />}
                </a>
              );
            })}
          </details>
        ))}
      </nav>
    </Card>
  );
}
