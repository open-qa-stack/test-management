import type { ReactNode } from "react";
import type { ConfigError, ConfiguredApplication } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { withPanel, type Route } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { SidePanel } from "../ui/side-panel.tsx";
import { AccountFields, EnvironmentFields, IdentityFields } from "../configuration/application-card.tsx";
import { AddButton, nameOf, PlaceErrors, RemoveButton } from "../configuration/configuration-fields.tsx";
import type { ConfigurationControls } from "../configuration/configuration-screen.tsx";
import { PartRow } from "../configuration/part-row.tsx";
import { isPending, shownErrors, type ConfigurationState } from "../configuration/configuration-state.ts";
import { SaveBar } from "../configuration/save-bar.tsx";

/** What the sheet of an application is drawn from. */
export interface ApplicationSheetProps {
  /** The application, as the draft holds it. */
  readonly application: ConfiguredApplication;
  /** Its rank in the draft. */
  readonly rank: number;
  /** Where the console is, which tells the panel open. */
  readonly route: Route;
  /** The draft of the configuration. */
  readonly state: ConfigurationState;
  readonly controls: ConfigurationControls;
}

/** The identifier of the title of the panel, which names it. */
const PANEL_TITLE = "application-panel-title";

/** The panel the route opens: a test account or an environment, by its rank; none otherwise. */
function panelOf(route: Route): { readonly kind: "account" | "environment"; readonly rank: number } | undefined {
  const [kind, rank] = (route.query["panel"] ?? "").split(":");
  return kind === "account" || kind === "environment" ? { kind, rank: Number(rank) } : undefined;
}

/**
 * An application on its page: what it is, open, then its test accounts and its environments, a row each. A test
 * account or an environment is added and changed in a panel, which saves the application or drops the change.
 *
 * @param props - The application, its rank, the route, the draft and what the person does to it.
 * @returns The sheet, and the panel the route opens.
 */
export function ApplicationSheet({ application, rank, route, state, controls }: ApplicationSheetProps): ReactNode {
  const at = `/applications/${rank}`;
  const accounts = application.authentication.accounts ?? [];
  const errors = shownErrors(state);
  const wrong = (pointer: string): boolean => errors.some(({ path }: ConfigError) => path === pointer || path.startsWith(`${pointer}/`));
  const panel = panelOf(route);
  const account = panel?.kind === "account" ? accounts[panel.rank] : undefined;
  const environment = panel?.kind === "environment" ? application.environments[panel.rank] : undefined;
  const close = withPanel(route);
  const footer = <SaveBar saving={state.saving} pending={isPending(state)} saved={t("configuration.item.saved")} discard={controls.discard} />;
  return (
    <>
      <Card>
        <div className="config-body">
          <IdentityFields at={at} application={application} />
        </div>
      </Card>
      <Card title={t("configuration.application.accounts")}>
        {accounts.length === 0 && <p className="row small muted">{t("configuration.application.noAccount")}</p>}
        {accounts.map((part, index) => (
          <PartRow
            key={index}
            name={part.name === "" ? t("configuration.application.account", { name: index + 1 }) : part.name}
            wrong={wrong(`${at}/authentication/accounts/${index}`)}
            href={withPanel(route, `account:${index}`)}
          />
        ))}
        <div className="row">
          <AddButton pointer={`${at}/authentication/accounts`} item="account" panel={`account:${accounts.length}`}>
            {t("configuration.application.addAccount")}
          </AddButton>
        </div>
      </Card>
      <Card title={t("configuration.application.environments")}>
        {application.environments.map((part, index) => (
          <PartRow
            key={index}
            name={part.name === "" ? t("configuration.application.environment", { name: index + 1 }) : part.name}
            facts={[part.uiUrl, t("configuration.application.apiCount", { count: part.apis?.length ?? 0 })].filter((fact) => fact !== "").join(" · ")}
            wrong={wrong(`${at}/environments/${index}`)}
            href={withPanel(route, `environment:${index}`)}
          />
        ))}
        <div className="row">
          <PlaceErrors pointer={`${at}/environments`} />
          <AddButton pointer={`${at}/environments`} item="environment" panel={`environment:${application.environments.length}`}>
            {t("configuration.application.addEnvironment")}
          </AddButton>
        </div>
      </Card>
      {account !== undefined && (
        <SidePanel id={PANEL_TITLE} title={t("configuration.application.account", { name: nameOf(account.name, panel!.rank) })} close={close} footer={footer}>
          <p className="field-hint">{t("configuration.application.accountsHint")}</p>
          <AccountFields at={`${at}/authentication/accounts/${panel!.rank}`} account={account} />
          <RemoveButton pointer={`${at}/authentication/accounts/${panel!.rank}`} label={t("configuration.application.removeAccount")} closes />
        </SidePanel>
      )}
      {environment !== undefined && (
        <SidePanel
          id={PANEL_TITLE}
          title={t("configuration.application.environment", { name: nameOf(environment.name, panel!.rank) })}
          close={close}
          footer={footer}
        >
          <EnvironmentFields
            at={`${at}/environments/${panel!.rank}`}
            environment={environment}
            name={t("configuration.application.theEnvironment", { name: nameOf(environment.name, panel!.rank) })}
          />
          <RemoveButton pointer={`${at}/environments/${panel!.rank}`} label={t("configuration.application.removeEnvironment")} closes />
        </SidePanel>
      )}
    </>
  );
}
