import { Fragment, type MouseEventHandler, type ReactNode } from "react";
import { MODEL_ROLES, MODEL_PROVIDERS, type Model, type ModelChoice, type ModelConnectionCheck } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { Card } from "../ui/card.tsx";
import { AdvancedFields, CheckField, ChoiceField, InputField, SecretField } from "./configuration-fields.tsx";
import type { ConnectionTest } from "./configuration-state.ts";
import { connectionOf, GITHUB_CHOICE, modelChoices, OTHER_CHOICE, sameReach } from "./model-connection.ts";

/** The ways to reach the model, in the order of the list: the GitHub account of the machine, the providers, another server. */
function connections(): readonly { readonly value: string; readonly label: string }[] {
  return [
    { value: GITHUB_CHOICE, label: t("configuration.model.github") },
    ...MODEL_PROVIDERS.map(({ name }) => ({ value: name, label: name })),
    { value: OTHER_CHOICE, label: t("configuration.model.other") },
  ];
}

/** What the card of the model is given. */
export interface ModelCardProps {
  /** The section `model` of the draft. */
  readonly model: Model;
  /** The latest test of the connection, when the person asked for one. */
  readonly connection?: ConnectionTest;
  /** Asks for a test of the connection the draft names. */
  readonly onTest: MouseEventHandler<HTMLButtonElement>;
}

/**
 * The model the agents call, as a person who is not in IT sets it: they choose how to reach it in a list, test
 * the connection, and pick the model in what it offers. The address and the key are asked only when the
 * connection needs them; a model for each role, and what an expert tunes stays folded under « Advanced ».
 *
 * @param props - The model of the draft, the latest test of its connection, and how to ask for one.
 * @returns Its card.
 */
export function ModelCard({ model, connection, onTest }: ModelCardProps): ReactNode {
  const choice = connectionOf(model);
  const test = connection !== undefined && sameReach(connection.model, model) ? connection : undefined;
  const models = modelChoices(test?.check, model.model);
  const chosen = models?.find(({ id }) => id === model.model);
  return (
    <Card id="config-model" title={t("configuration.model.title")} hint={t("configuration.model.hint")}>
      <div className="config-body config-fields">
        <ChoiceField pointer="/model/mode" kind="connection" label={t("configuration.model.connection")} value={choice} options={connections()} />
        {model.mode === "github" ? (
          <p className="small muted">{t("configuration.model.githubNote")}</p>
        ) : (
          <>
            {choice === OTHER_CHOICE && (
              <InputField
                pointer="/model/baseUrl"
                label={t("configuration.model.baseUrl")}
                hint={t("configuration.model.baseUrlHint")}
                value={model.baseUrl}
                code
                placeholder="http://localhost:1234/v1"
              />
            )}
            <SecretField variable={model.apiKeyEnv} kind="model_key" />
            <AdvancedFields pointers={["/model/apiKeyEnv"]}>
              <InputField
                pointer="/model/apiKeyEnv"
                label={t("configuration.model.apiKeyEnv")}
                hint={t("configuration.model.apiKeyEnvHint")}
                value={model.apiKeyEnv}
                code
              />
            </AdvancedFields>
          </>
        )}
        <div className="config-actions">
          <button
            type="button"
            className="btn sm"
            onClick={onTest}
            disabled={connection !== undefined && connection.check === undefined && connection.failure === undefined}
          >
            {t("configuration.model.test")}
          </button>
        </div>
        <TestResult test={test} />
        {models === undefined ? (
          <InputField pointer="/model/model" label={t("configuration.model.model")} hint={t("configuration.model.modelHint")} value={model.model} code />
        ) : (
          <ChoiceField
            pointer="/model/model"
            label={t("configuration.model.model")}
            value={model.model}
            none={t("configuration.model.pick")}
            options={models.map(({ id, name }) => ({ value: id, label: name === id ? id : `${name} (${id})` }))}
          />
        )}
        <Roles model={model} models={models} />
        <Advanced model={model} chosen={chosen} />
      </div>
    </Card>
  );
}

/** What the latest test found, in plain words: what works, or what to do. */
function TestResult({ test }: { readonly test: ConnectionTest | undefined }): ReactNode {
  if (test === undefined) return null;
  if (test.failure !== undefined)
    return (
      <p className="config-note ko" role="status">
        {t("configuration.model.failed", { reason: test.failure })}
      </p>
    );
  if (test.check === undefined)
    return (
      <p className="small muted" role="status">
        {t("configuration.model.testing")}
      </p>
    );
  return <CheckText check={test.check} />;
}

/** The sentence of a test that was made. */
function CheckText({ check }: { readonly check: ModelConnectionCheck }): ReactNode {
  switch (check.state) {
    case "connected":
      return (
        <p className="config-note ok" role="status">
          {check.account === undefined ? t("configuration.model.connected") : t("configuration.model.connectedAs", { account: check.account })}{" "}
          {check.models === undefined ? t("configuration.model.noList") : t("configuration.model.pickBelow")}
        </p>
      );
    case "signed-out":
      return (
        <p className="config-note warn" role="status">
          {t("configuration.model.signedOut")} <code className="mono">gh auth login</code>
        </p>
      );
    case "no-models":
      return (
        <p className="config-note warn" role="status">
          {t("configuration.model.noModels", { account: check.account })}
        </p>
      );
    case "key-missing":
      return (
        <p className="config-note warn" role="status">
          {t("configuration.model.keyMissing", { variable: check.variable })}
        </p>
      );
    case "key-refused":
      return (
        <p className="config-note ko" role="status">
          {t("configuration.model.keyRefused", { status: check.status })}
        </p>
      );
    case "unreachable":
      return (
        <p className="config-note ko" role="status">
          {t("configuration.model.unreachable", { url: check.url })}
        </p>
      );
  }
}

/** The model of each role, folded: one of those the connection offers, or its name, or that of every one when it is left empty; and whether it reads images. */
function Roles({ model, models }: { readonly model: Model; readonly models: readonly ModelChoice[] | undefined }): ReactNode {
  return (
    <details className="config-advanced">
      <summary>{t("configuration.model.roles.title")}</summary>
      <p className="small muted">{t("configuration.model.roles.hint")}</p>
      <div className="config-fields">
        {MODEL_ROLES.map((role) => {
          const own = model.roles?.[role];
          const field = { pointer: `/model/roles/${role}`, label: t(`configuration.model.roles.${role}`), value: own?.model, kind: "role" as const };
          const offered = models === undefined ? undefined : modelChoices({ state: "connected", models }, own?.model ?? "");
          return (
            <Fragment key={role}>
              {offered === undefined ? (
                <InputField {...field} placeholder={t("configuration.model.roles.same")} code />
              ) : (
                <ChoiceField
                  {...field}
                  none={t("configuration.model.roles.same")}
                  options={offered.map(({ id, name }) => ({ value: id, label: name === id ? id : `${name} (${id})` }))}
                />
              )}
              {own !== undefined && (
                <CheckField
                  pointer={`/model/roles/${role}/capabilities`}
                  member="vision"
                  label={t("configuration.model.vision")}
                  checked={own.capabilities?.includes("vision") === true}
                />
              )}
            </Fragment>
          );
        })}
      </div>
    </details>
  );
}

/** What an expert tunes, folded: the effort of reasoning, the wait for an answer, and whether the model reads images. */
function Advanced({ model, chosen }: { readonly model: Model; readonly chosen: ModelChoice | undefined }): ReactNode {
  const efforts = chosen?.reasoningEfforts ?? [];
  return (
    <details className="config-advanced">
      <summary>{t("configuration.model.advanced")}</summary>
      <div className="config-fields">
        {efforts.length > 0 ? (
          <ChoiceField
            pointer="/model/reasoningEffort"
            label={t("configuration.model.reasoningEffort")}
            value={model.reasoningEffort}
            none={t("configuration.model.byDefault")}
            options={efforts.map((effort) => ({ value: effort, label: effort }))}
          />
        ) : (
          <InputField
            pointer="/model/reasoningEffort"
            label={t("configuration.model.reasoningEffort")}
            hint={t("configuration.model.reasoningEffortHint")}
            value={model.reasoningEffort}
          />
        )}
        {model.mode === "provider-key" && (
          <InputField
            pointer="/model/requestTimeoutSeconds"
            label={t("configuration.model.timeout")}
            value={model.requestTimeoutSeconds}
            numeric
            placeholder="120"
          />
        )}
        <CheckField
          pointer="/model/capabilities"
          member="vision"
          label={t("configuration.model.vision")}
          hint={chosen?.vision === true ? t("configuration.model.visionTold") : t("configuration.model.visionHint")}
          checked={model.capabilities?.includes("vision") === true}
        />
      </div>
    </details>
  );
}
