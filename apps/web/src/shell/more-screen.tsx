import type { ReactNode } from "react";
import { hrefTo } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { summariesOf, type MoreFacts } from "./more-facts.ts";
import { MORE } from "./navigation.ts";

/**
 * The screen of the entries the tabs of a phone leave out: each of them under the heading of its group, a row that
 * opens it and says where it stands.
 *
 * @param props - The name of the project, and what the instance told of where the entries stand.
 * @returns The screen.
 */
export function MoreScreen({ project, facts }: { readonly project: string; readonly facts: MoreFacts }): ReactNode {
  const summaries = summariesOf(facts);
  const hint = [project, summaries.applications].filter((part) => part !== undefined).join(" · ");
  return (
    <Page crumbs={[{ label: project }, { label: t("shell.more") }]} title={t("shell.more")} hint={hint}>
      {MORE.map((group) => (
        <section key={group.key} className="more-group" aria-labelledby={`more-${group.key}`}>
          <h2 id={`more-${group.key}`} className="grp">
            {t(`shell.groups.${group.key}`)}
          </h2>
          <div className="more-list">
            {group.entries.map((entry) => (
              <a key={entry.key} className="more-link" href={hrefTo(entry.path)}>
                <Icon name={entry.icon} />
                <span className="more-text">
                  <span>{t(`shell.entries.${entry.key}`)}</span>
                  {summaries[entry.key] !== undefined && <small>{summaries[entry.key]}</small>}
                </span>
                <Icon name="chevron" />
              </a>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
