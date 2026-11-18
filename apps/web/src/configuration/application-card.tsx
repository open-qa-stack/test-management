import type { ReactNode } from "react";
import type { ConfiguredApplication, Environment } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { AddButton, ChoiceField, InputField, PlaceErrors, RemoveButton } from "./configuration-fields.tsx";

/** The choices of a list, each its value and its label. */
function choices<const V extends string>(values: readonly V[], label: (value: V) => string): { readonly value: V; readonly label: string }[] {
  return values.map((value) => ({ value, label: label(value) }));
}

/**
 * The name of an item of a list, or its rank when it has none yet.
 *
 * @param name - The name of the item.
 * @param rank - Its rank in the list.
 * @returns The name, or the rank from one.
 */
const nameOf = (name: string, rank: number): string => (name === "" ? String(rank + 1) : name);

/**
 * The head of an item of a list: what it is, and the button that removes it, which names it.
 *
 * @param props - What the item is called, and where it is.
 * @returns The head.
 */
function ItemHead({ title, pointer, removal }: { readonly title: string; readonly pointer: string; readonly removal: string }): ReactNode {
  return (
    <div className="config-item-head">
      <span>{title}</span>
      <RemoveButton pointer={pointer} label={removal} />
    </div>
  );
}

/** An environment of an application: its addresses, its named APIs and what its exploration may do. */
function EnvironmentFields({
  at,
  environment,
  rank,
  owner,
}: {
  readonly at: string;
  readonly environment: Environment;
  readonly rank: number;
  readonly owner: string;
}): ReactNode {
  const apis = environment.apis ?? [];
  const name = t("configuration.application.theEnvironment", { name: nameOf(environment.name, rank) });
  return (
    <fieldset className="config-group">
      <legend className="sr-only">{t("configuration.application.environment", { name: rank + 1 })}</legend>
      <ItemHead
        title={t("configuration.application.environment", { name: nameOf(environment.name, rank) })}
        pointer={at}
        removal={t("configuration.application.removeFrom", { item: name, owner })}
      />
      <div className="config-fields">
        <InputField
          pointer={`${at}/name`}
          label={t("configuration.application.name")}
          value={environment.name}
          hint={t("configuration.application.environmentNameHint")}
        />
        <InputField pointer={`${at}/uiUrl`} label={t("configuration.application.uiUrl")} value={environment.uiUrl} code placeholder="https://" />
        <ChoiceField
          pointer={`${at}/exploration`}
          label={t("configuration.application.exploration")}
          hint={t("configuration.application.explorationHint")}
          value={environment.exploration}
          options={choices(["read-only", "read-write"], (value) => t(`configuration.application.explorations.${value}`))}
          none={t("configuration.application.explorationDefault")}
        />
      </div>
      {apis.map((api, index) => (
        <div key={index} className="config-item">
          <ItemHead
            title={t("configuration.application.api", { name: nameOf(api.name, index) })}
            pointer={`${at}/apis/${index}`}
            removal={t("configuration.application.removeFrom", { item: t("configuration.application.theApi", { name: nameOf(api.name, index) }), owner: name })}
          />
          <div className="config-fields">
            <InputField pointer={`${at}/apis/${index}/name`} label={t("configuration.application.apiName")} value={api.name} />
            <InputField
              pointer={`${at}/apis/${index}/baseUrl`}
              label={t("configuration.application.baseUrl")}
              value={api.baseUrl}
              code
              placeholder="https://"
            />
          </div>
        </div>
      ))}
      <div className="config-actions">
        <AddButton pointer={`${at}/apis`} item="api">
          {t("configuration.application.addApi")}
        </AddButton>
      </div>
    </fieldset>
  );
}

/**
 * An application of the configuration: what it is, how a user signs in with the variables of its test accounts,
 * and its environments.
 *
 * @param props - The application, and its rank in the list.
 * @returns Its card.
 */
export function ApplicationCard({ application, rank }: { readonly application: ConfiguredApplication; readonly rank: number }): ReactNode {
  const at = `/applications/${rank}`;
  const accounts = application.authentication.accounts ?? [];
  const title = application.name === "" ? t("configuration.application.untitled", { rank: rank + 1 }) : application.name;
  return (
    <Card
      title={title}
      hint={application.id === "" ? t("configuration.application.noId") : application.id}
      aside={<RemoveButton pointer={at} label={t("configuration.application.removeApplication", { name: title })} />}
    >
      <div className="config-body">
        <div className="config-fields">
          <InputField pointer={`${at}/id`} label={t("configuration.application.id")} value={application.id} code hint={t("configuration.application.idHint")} />
          <InputField pointer={`${at}/name`} label={t("configuration.application.name")} value={application.name} />
          <ChoiceField
            pointer={`${at}/type`}
            label={t("configuration.application.type")}
            value={application.type}
            options={choices(["web", "api", "web-and-api"], (value) => t(`configuration.application.types.${value}`))}
          />
          <ChoiceField
            pointer={`${at}/authentication/method`}
            label={t("configuration.application.method")}
            value={application.authentication.method}
            options={choices(["none", "form"], (value) => t(`configuration.application.methods.${value}`))}
          />
        </div>
        <fieldset className="config-group">
          <legend>{t("configuration.application.accounts")}</legend>
          <p className="field-hint">{t("configuration.application.accountsHint")}</p>
          {accounts.map((account, index) => (
            <div key={index} className="config-item">
              <ItemHead
                title={t("configuration.application.account", { name: nameOf(account.name, index) })}
                pointer={`${at}/authentication/accounts/${index}`}
                removal={t("configuration.application.removeFrom", {
                  item: t("configuration.application.theAccount", { name: nameOf(account.name, index) }),
                  owner: title,
                })}
              />
              <div className="config-fields">
                <InputField pointer={`${at}/authentication/accounts/${index}/name`} label={t("configuration.application.accountName")} value={account.name} />
                <InputField
                  pointer={`${at}/authentication/accounts/${index}/usernameEnv`}
                  label={t("configuration.application.usernameEnv")}
                  value={account.usernameEnv}
                  code
                />
                <InputField
                  pointer={`${at}/authentication/accounts/${index}/passwordEnv`}
                  label={t("configuration.application.passwordEnv")}
                  value={account.passwordEnv}
                  code
                />
              </div>
            </div>
          ))}
          <div className="config-actions">
            <AddButton pointer={`${at}/authentication/accounts`} item="account">
              {t("configuration.application.addAccount")}
            </AddButton>
          </div>
        </fieldset>
        {application.environments.map((environment, index) => (
          <EnvironmentFields key={index} at={`${at}/environments/${index}`} environment={environment} rank={index} owner={title} />
        ))}
        <PlaceErrors pointer={`${at}/environments`} />
        <div className="config-actions">
          <AddButton pointer={`${at}/environments`} item="environment">
            {t("configuration.application.addEnvironment")}
          </AddButton>
        </div>
      </div>
    </Card>
  );
}
