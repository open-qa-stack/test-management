import type { MouseEventHandler, ReactNode } from "react";
import { isStoredDocuments, type Attachment, type ConfiguredApplication, type Knowledge } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { AddButton, choices, ChoiceField, InputField, ItemHead, PlaceErrors, RemoveButton, SecretField } from "./configuration-fields.tsx";
import type { NewItem } from "./configuration-edit.ts";
import type { SourceTest } from "./configuration-state.ts";

/** The kinds of sources a button adds, in the order the section offers them. */
export const SOURCE_KINDS = ["openapi", "postgresql", "document", "stored", "source-code", "logs"] as const satisfies readonly NewItem[];

/** A kind of source a button adds. */
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** The kinds the setting up offers, for a person who is not in IT: a contract of an API, the code, a database, documents. */
export const FIRST_KINDS: readonly SourceKind[] = ["openapi", "source-code", "postgresql", "stored"];

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
 * @param props - The source, its rank in the list, the applications of the draft it may be attached to, the latest test of
 * the source, and how to ask for one.
 * @returns Its card.
 */
export function KnowledgeCard({
  source,
  rank,
  applications,
  test,
  onCheck,
}: {
  readonly source: Knowledge;
  readonly rank: number;
  readonly applications: readonly ConfiguredApplication[];
  /** The latest test of the source, when the person asked for one. */
  readonly test?: SourceTest;
  /** Asks for a test of the source its button names by its rank. */
  readonly onCheck: MouseEventHandler<HTMLButtonElement>;
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
        {source.type !== "logs" && (
          <div className="config-actions">
            <button
              type="button"
              className="btn sm"
              data-rank={rank}
              onClick={onCheck}
              disabled={test?.source === source && test.check === undefined && test.failure === undefined}
            >
              {t("configuration.knowledge.check")}
            </button>
          </div>
        )}
        <CheckResult test={test?.source === source ? test : undefined} />
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
 * @param props - The kinds offered, in their order; every kind by default.
 * @returns Them.
 */
export function AddSourceButtons({ kinds = SOURCE_KINDS }: { readonly kinds?: readonly SourceKind[] }): ReactNode {
  return (
    <div className="config-actions">
      {kinds.map((kind) => (
        <AddButton key={kind} pointer="/knowledge" item={kind}>
          {t(`configuration.knowledge.add.${kind}`)}
        </AddButton>
      ))}
    </div>
  );
}

/** What the latest test of a source found, in plain words; nothing before one, nor once the source changed since. */
function CheckResult({ test }: { readonly test: SourceTest | undefined }): ReactNode {
  if (test === undefined) return null;
  if (test.failure !== undefined)
    return (
      <p className="config-note ko" role="status">
        {t("configuration.knowledge.checkFailed", { reason: test.failure })}
      </p>
    );
  if (test.check === undefined)
    return (
      <p className="small muted" role="status">
        {t("configuration.knowledge.checking")}
      </p>
    );
  switch (test.check.state) {
    case "ok":
      return (
        <p className="config-note ok" role="status">
          {t("configuration.knowledge.answered", { count: test.check.items })}
        </p>
      );
    case "failed":
      return (
        <p className="config-note ko" role="status">
          {t("configuration.knowledge.unanswered", { reason: test.check.reason })}
        </p>
      );
    case "unchecked":
      return (
        <p className="small muted" role="status">
          {t("configuration.knowledge.unchecked")}
        </p>
      );
  }
}
