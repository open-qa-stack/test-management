import type { ReactNode } from "react";
import { isStoredDocuments, type Attachment, type ConfiguredApplication, type Knowledge } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { AddButton, choices, ChoiceField, InputField, ItemHead, PlaceErrors, RemoveButton, SecretField } from "./configuration-fields.tsx";
import type { NewItem } from "./configuration-edit.ts";

/** The kinds of sources a button adds, in the order the section offers them. */
export const SOURCE_KINDS = ["openapi", "postgresql", "document", "stored", "source-code", "logs"] as const satisfies readonly NewItem[];

/** A kind of source a button adds. */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/**
 * Tells the kind of a source: its type, or `stored` for documents the instance keeps.
 *
 * @param source - The source.
 * @returns Its kind.
 */
export function kindOf(source: Knowledge): SourceKind {
  return isStoredDocuments(source) ? "stored" : source.type;
}

/** The choices of a list, with the value the draft holds when it is none of them: the draft is shown as it is, and its error beside it. */
function withHeld(values: readonly string[], held: string | undefined): { readonly value: string; readonly label: string }[] {
  const all = held === undefined || held === "" || values.includes(held) ? values : [...values, held];
  return all.map((value) => ({ value, label: value }));
}

/** An attachment of a source: an application, and optionally one of its environments and one of the APIs of that environment. */
function AttachmentFields({
  at,
  attachment,
  rank,
  owner,
  applications,
}: {
  readonly at: string;
  readonly attachment: Partial<Attachment>;
  readonly rank: number;
  readonly owner: string;
  readonly applications: readonly ConfiguredApplication[];
}): ReactNode {
  const application = applications.find((candidate) => candidate.id === attachment.application);
  const environment = application?.environments.find((candidate) => candidate.name === attachment.environment);
  const title = t("configuration.knowledge.attachment", { rank: rank + 1 });
  return (
    <div className="config-item">
      <ItemHead
        title={title}
        pointer={at}
        removal={t("configuration.application.removeFrom", { item: t("configuration.knowledge.theAttachment", { rank: rank + 1 }), owner })}
      />
      <div className="config-fields">
        <ChoiceField
          pointer={`${at}/application`}
          label={t("configuration.knowledge.application")}
          value={attachment.application}
          options={withHeld(
            applications.map(({ id }) => id).filter((id) => id !== ""),
            attachment.application,
          )}
          none={t("configuration.knowledge.chooseApplication")}
        />
        <ChoiceField
          pointer={`${at}/environment`}
          label={t("configuration.knowledge.environment")}
          value={attachment.environment}
          options={withHeld(
            (application?.environments ?? []).map(({ name }) => name).filter((name) => name !== ""),
            attachment.environment,
          )}
          none={t("configuration.knowledge.anyEnvironment")}
        />
        <ChoiceField
          pointer={`${at}/api`}
          label={t("configuration.knowledge.api")}
          value={attachment.api}
          options={withHeld(
            (environment?.apis ?? []).map(({ name }) => name).filter((name) => name !== ""),
            attachment.api,
          )}
          none={t("configuration.knowledge.anyApi")}
        />
      </div>
    </div>
  );
}

/** The fields of what a source is read from, which its kind tells: an address, a file, a folder, a container or a variable, never a secret. */
function WhereFields({ at, source }: { readonly at: string; readonly source: Knowledge }): ReactNode {
  switch (source.type) {
    case "openapi":
      return (
        <>
          <InputField
            pointer={`${at}/url`}
            label={t("configuration.knowledge.url")}
            value={source.url}
            code
            placeholder="https://"
            hint={t("configuration.knowledge.openapiHint")}
          />
          <InputField pointer={`${at}/path`} label={t("configuration.knowledge.contractPath")} value={source.path} code />
        </>
      );
    case "postgresql":
      return (
        <>
          <InputField
            pointer={`${at}/connectionStringEnv`}
            label={t("configuration.knowledge.connectionStringEnv")}
            value={source.connectionStringEnv}
            code
            hint={t("configuration.knowledge.connectionStringEnvHint")}
          />
          <SecretField variable={source.connectionStringEnv} kind="connection_string" />
        </>
      );
    case "document":
      return source.stored === true ? (
        <div className="config-field">
          <p className="field-hint">{t("configuration.knowledge.storedNote")}</p>
          {source.id !== "" && (
            <div className="config-actions">
              <a className="btn sm" href={hrefTo(`/knowledge/${source.id}`)}>
                {t("configuration.knowledge.openKnowledge")}
              </a>
            </div>
          )}
        </div>
      ) : (
        <InputField
          pointer={`${at}/path`}
          label={t("configuration.knowledge.documentPath")}
          value={source.path}
          code
          hint={t("configuration.knowledge.documentPathHint")}
        />
      );
    case "source-code":
      return (
        <>
          <InputField
            pointer={`${at}/path`}
            label={t("configuration.knowledge.codePath")}
            value={source.path}
            code
            hint={t("configuration.knowledge.codePathHint")}
          />
          <ChoiceField
            pointer={`${at}/commands`}
            label={t("configuration.knowledge.commands")}
            value={source.commands}
            options={choices(["none", "git", "shell"], (value) => t(`configuration.knowledge.commandChoices.${value}`))}
            none={t("configuration.knowledge.commandsDefault")}
          />
        </>
      );
    case "logs":
      return (
        <>
          <InputField
            pointer={`${at}/path`}
            label={t("configuration.knowledge.logPath")}
            value={source.path}
            code
            hint={t("configuration.knowledge.logsHint")}
          />
          <InputField pointer={`${at}/container`} label={t("configuration.knowledge.container")} value={source.container} code />
          <ChoiceField
            pointer={`${at}/engine`}
            label={t("configuration.knowledge.engine")}
            value={source.engine}
            options={choices(["podman", "docker"], (value) => value)}
            none={t("configuration.knowledge.noEngine")}
          />
        </>
      );
  }
}

/**
 * A knowledge source of the configuration: its identifier, what it is read from — never a secret — and the
 * applications, environments and APIs it is attached to. Its kind is chosen when it is added.
 *
 * @param props - The source, its rank in the list, and the applications of the draft it may be attached to.
 * @returns Its card.
 */
export function KnowledgeCard({
  source,
  rank,
  applications,
}: {
  readonly source: Knowledge;
  readonly rank: number;
  readonly applications: readonly ConfiguredApplication[];
}): ReactNode {
  const at = `/knowledge/${rank}`;
  const title = source.id === "" ? t("configuration.knowledge.untitled", { rank: rank + 1 }) : source.id;
  return (
    <Card
      title={title}
      hint={t(`configuration.knowledge.kinds.${kindOf(source)}`)}
      aside={<RemoveButton pointer={at} label={t("configuration.knowledge.removeSource", { name: title })} />}
    >
      <div className="config-body">
        <PlaceErrors pointer={at} />
        <div className="config-fields">
          <InputField pointer={`${at}/id`} label={t("configuration.application.id")} value={source.id} code hint={t("configuration.application.idHint")} />
          <WhereFields at={at} source={source} />
        </div>
        <fieldset className="config-group">
          <legend>{t("configuration.knowledge.attachments")}</legend>
          <p className="field-hint">{t("configuration.knowledge.attachmentsHint")}</p>
          <PlaceErrors pointer={`${at}/attachments`} />
          {source.attachments.map((attachment, index) => (
            <AttachmentFields key={index} at={`${at}/attachments/${index}`} attachment={attachment} rank={index} owner={title} applications={applications} />
          ))}
          <div className="config-actions">
            <AddButton pointer={`${at}/attachments`} item="attachment">
              {t("configuration.knowledge.addAttachment")}
            </AddButton>
          </div>
        </fieldset>
      </div>
    </Card>
  );
}

/**
 * The buttons that add a source of each kind.
 *
 * @returns Them.
 */
export function AddSourceButtons(): ReactNode {
  return (
    <div className="config-actions">
      {SOURCE_KINDS.map((kind) => (
        <AddButton key={kind} pointer="/knowledge" item={kind}>
          {t(`configuration.knowledge.add.${kind}`)}
        </AddButton>
      ))}
    </div>
  );
}
