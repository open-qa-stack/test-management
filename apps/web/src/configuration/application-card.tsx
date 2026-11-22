import type { ReactNode } from "react";
import type { ConfiguredApplication, Environment } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import {
  AddButton,
  AdvancedFields,
  choices,
  ChoiceField,
  InputField,
  ItemHead,
  nameOf,
  PlaceErrors,
  RemoveButton,
  SecretField,
} from "./configuration-fields.tsx";

/** A test account of an application. */
export type TestAccount = NonNullable<ConfiguredApplication["authentication"]["accounts"]>[number];

/** The name of an application as a person reads it: its name, or its rank while it has none. */
export const applicationTitle = (application: ConfiguredApplication, rank: number): string =>
  application.name === "" ? t("configuration.application.untitled", { rank: rank + 1 }) : application.name;

/**
 * What an application is: its name, what it exposes and how a user signs in, then, folded, its identifier.
 *
 * @param props - Where the application is in the draft, and the application.
 * @returns The fields.
 */
export function IdentityFields({ at, application }: { readonly at: string; readonly application: ConfiguredApplication }): ReactNode {
  return (
    <>
      <div className="config-fields">
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
      <AdvancedFields pointers={[`${at}/id`]}>
        <InputField pointer={`${at}/id`} label={t("configuration.application.id")} value={application.id} code hint={t("configuration.application.idHint")} />
      </AdvancedFields>
    </>
  );
}

/**
 * A test account: its name, its identifier and its password typed beside the variables that hold them, then, folded,
 * those variables.
 *
 * @param props - Where the account is in the draft, and the account.
 * @returns The fields.
 */
export function AccountFields({ at, account }: { readonly at: string; readonly account: TestAccount }): ReactNode {
  return (
    <>
      <div className="config-fields">
        <InputField pointer={`${at}/name`} label={t("configuration.application.accountName")} value={account.name} />
        <SecretField variable={account.usernameEnv} kind="account_username" />
        <SecretField variable={account.passwordEnv} kind="account_password" />
      </div>
      <AdvancedFields pointers={[`${at}/usernameEnv`, `${at}/passwordEnv`]}>
        <InputField pointer={`${at}/usernameEnv`} label={t("configuration.application.usernameEnv")} value={account.usernameEnv} code />
        <InputField pointer={`${at}/passwordEnv`} label={t("configuration.application.passwordEnv")} value={account.passwordEnv} code />
      </AdvancedFields>
    </>
  );
}

/**
 * An environment of an application: its name, the address of its interface and what its exploration may do, then its
 * named APIs, each with the button that removes it, and the button that adds one.
 *
 * @param props - Where the environment is in the draft, the environment, and what it is called in a removal.
 * @returns The fields.
 */
export function EnvironmentFields({ at, environment, name }: { readonly at: string; readonly environment: Environment; readonly name: string }): ReactNode {
  const apis = environment.apis ?? [];
  return (
    <>
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
    </>
  );
}

/**
 * An application of a list of the configuration, every field open: what it is, its test accounts and its
 * environments, each with the button that removes it, and the button that removes the application.
 *
 * @param props - The application, and its rank in the list.
 * @returns Its card.
 */
export function ApplicationCard({ application, rank }: { readonly application: ConfiguredApplication; readonly rank: number }): ReactNode {
  const at = `/applications/${rank}`;
  const accounts = application.authentication.accounts ?? [];
  const title = applicationTitle(application, rank);
  return (
    <Card
      title={title}
      hint={application.id === "" ? t("configuration.application.noId") : application.id}
      aside={<RemoveButton pointer={at} label={t("configuration.application.removeApplication", { name: title })} />}
    >
      <div className="config-body">
        <IdentityFields at={at} application={application} />
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
              <AccountFields at={`${at}/authentication/accounts/${index}`} account={account} />
            </div>
          ))}
          <div className="config-actions">
            <AddButton pointer={`${at}/authentication/accounts`} item="account">
              {t("configuration.application.addAccount")}
            </AddButton>
          </div>
        </fieldset>
        {application.environments.map((environment, index) => {
          const name = t("configuration.application.environment", { name: nameOf(environment.name, index) });
          return (
            <fieldset key={index} className="config-group">
              <legend className="sr-only">{t("configuration.application.environment", { name: index + 1 })}</legend>
              <ItemHead
                title={name}
                pointer={`${at}/environments/${index}`}
                removal={t("configuration.application.removeFrom", {
                  item: t("configuration.application.theEnvironment", { name: nameOf(environment.name, index) }),
                  owner: title,
                })}
              />
              <EnvironmentFields
                at={`${at}/environments/${index}`}
                environment={environment}
                name={t("configuration.application.theEnvironment", { name: nameOf(environment.name, index) })}
              />
            </fieldset>
          );
        })}
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
