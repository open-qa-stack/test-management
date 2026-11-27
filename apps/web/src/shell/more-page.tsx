import type { ReactNode } from "react";
import { hrefTo } from "../routing/route.ts";
import { t } from "../i18n/i18n.ts";
import { Icon } from "../ui/icon.tsx";
import { Page } from "../ui/page.tsx";
import { MORE } from "./navigation.ts";

/**
 * The screen of the entries the tabs of a phone leave out: each of them under the heading of its group, a row that
 * opens it.
 *
 * @param props - The name of the project.
 * @returns The screen.
 */
export function MorePage({ project }: { readonly project: string }): ReactNode {
  return (
    <Page crumbs={[{ label: project }, { label: t("shell.more") }]} title={t("shell.more")}>
      {MORE.map((group) => (
        <section key={group.key} className="more-group" aria-labelledby={`more-${group.key}`}>
          <h2 id={`more-${group.key}`} className="grp">
            {t(`shell.groups.${group.key}`)}
          </h2>
          <div className="more-list">
            {group.entries.map((entry) => (
              <a key={entry.key} className="more-link" href={hrefTo(entry.path)}>
                <Icon name={entry.icon} />
                <span>{t(`shell.entries.${entry.key}`)}</span>
                <Icon name="chevron" />
              </a>
            ))}
          </div>
        </section>
      ))}
    </Page>
  );
}
