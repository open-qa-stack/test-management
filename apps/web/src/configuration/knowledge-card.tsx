import { useContext, type MouseEventHandler, type ReactNode } from "react";
import { attachmentsOf, isProjectWide, isStoredDocuments, type Attachment, type ConfiguredApplication, type Knowledge } from "@open-qa-stack/domain/sessions";
import { t } from "../i18n/i18n.ts";
import { hrefTo } from "../routing/route.ts";
import { Card } from "../ui/card.tsx";
import { Icon, type IconName } from "../ui/icon.tsx";
import { AddButton, AdvancedFields, choices, ChoiceField, InputField, ItemHead, PlaceErrors, RemoveButton, SecretField } from "./configuration-fields.tsx";
import { EditContext, type NewItem } from "./configuration-edit.ts";
import { PartRow } from "./part-row.tsx";
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

/**
 * Says what an attachment of a source serves: its application, then the environment and the API it narrows to, or
 * every environment.
 *
 * @param attachment - The attachment, as the draft holds it.
 * @param applications - The applications of the draft.
 * @returns What it serves, in words.
 */
export function attachmentTitle(attachment: Partial<Attachment>, applications: readonly ConfiguredApplication[]): string {
  const application = applications.find((candidate) => candidate.id === attachment.application);
  const where =
    attachment.environment === undefined
      ? t("configuration.knowledge.everyEnvironment")
      : [attachment.environment, attachment.api].filter((part) => part !== undefined).join(" › ");
  const served = application === undefined ? t("configuration.knowledge.noApplication") : application.name === "" ? application.id : application.name;
  return t("configuration.knowledge.serves", { application: served, where });
}

/**
 * The fields of an attachment of a source: an application, and optionally one of its environments and one of the APIs
 * of that environment.
 *
 * @param props - Where the attachment is, the attachment, and the applications of the draft.
 * @returns The fields.
 */
export function AttachmentChoices({
  at,
  attachment,
  applications,
}: {
  readonly at: string;
  readonly attachment: Partial<Attachment>;
  readonly applications: readonly ConfiguredApplication[];
}): ReactNode {
  const application = applications.find((candidate) => candidate.id === attachment.application);
  const environment = application?.environments.find((candidate) => candidate.name === attachment.environment);
  return (
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
  );
}

/** The attachments of a source, as rows that each open the panel that changes it, or their fields open. */
function Attachments({
  at,
  source,
  owner,
  applications,
  panelOf,
}: {
  readonly at: string;
  readonly source: Knowledge;
  readonly owner: string;
  readonly applications: readonly ConfiguredApplication[];
  readonly panelOf: ((rank: number) => string) | undefined;
}): ReactNode {
  const { errors } = useContext(EditContext);
  const attachments = attachmentsOf(source);
  return (
    <>
      {attachments.map((attachment, index) => {
        const pointer = `${at}/attachments/${index}`;
        const title = attachmentTitle(attachment, applications);
        return panelOf === undefined ? (
          <div key={index} className="config-item">
            <ItemHead
              title={title}
              pointer={pointer}
              removal={t("configuration.application.removeFrom", { item: t("configuration.knowledge.theAttachment", { rank: index + 1 }), owner })}
            />
            <AttachmentChoices at={pointer} attachment={attachment} applications={applications} />
          </div>
        ) : (
          <PartRow key={index} name={title} wrong={errors.some(({ path }) => path === pointer || path.startsWith(`${pointer}/`))} href={panelOf(index)} />
        );
      })}
      {!isProjectWide(source) && (
        <div className="config-actions">
          <AddButton pointer={`${at}/attachments`} item="attachment" {...(panelOf === undefined ? {} : { panel: `attachment:${attachments.length}` })}>
            {t("configuration.knowledge.addAttachment")}
          </AddButton>
        </div>
      )}
    </>
  );
}

/** The fields of what a source is read from, which its kind tells: an address, a file, a folder, a container or a variable, never a secret. */
function WhereFields({ at, source, documentsLink }: { readonly at: string; readonly source: Knowledge; readonly documentsLink: boolean }): ReactNode {
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
          <SecretField variable={source.connectionStringEnv} kind="connection_string" />
          <AdvancedFields pointers={[`${at}/connectionStringEnv`]}>
            <InputField
              pointer={`${at}/connectionStringEnv`}
              label={t("configuration.knowledge.connectionStringEnv")}
              value={source.connectionStringEnv}
              code
              hint={t("configuration.knowledge.connectionStringEnvHint")}
            />
          </AdvancedFields>
        </>
      );
    case "document":
      return source.stored === true ? (
        <div className="config-field">
          <p className="field-hint">{t("configuration.knowledge.storedNote")}</p>
          {documentsLink && source.id !== "" && (
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
          <AdvancedFields pointers={[`${at}/commands`]}>
            <ChoiceField
              pointer={`${at}/commands`}
              label={t("configuration.knowledge.commands")}
              value={source.commands}
              options={choices(["none", "git", "shell"], (value) => t(`configuration.knowledge.commandChoices.${value}`))}
              none={t("configuration.knowledge.commandsDefault")}
            />
          </AdvancedFields>
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
 * the source, how to ask for one, whether the card offers to remove it, and how its attachments are changed.
 * @returns Its card.
 */
export function KnowledgeCard({
  source,
  rank,
  applications,
  test,
  onCheck,
  removable = true,
  documentsLink = true,
  named = true,
  attachmentPanel,
}: {
  readonly source: Knowledge;
  readonly rank: number;
  readonly applications: readonly ConfiguredApplication[];
  /** The latest test of the source, when the person asked for one. */
  readonly test?: SourceTest;
  /** Asks for a test of the source its button names by its rank. */
  readonly onCheck: MouseEventHandler<HTMLButtonElement>;
  /** Whether the card offers to remove the source from the draft: a screen that removes it otherwise says no. */
  readonly removable?: boolean;
  /** Whether the card of a source of documents the instance keeps leads to them: not on the page that shows them. */
  readonly documentsLink?: boolean;
  /** Whether the card names the source, or its kind alone, on a page the source names already. */
  readonly named?: boolean;
  /** The link that opens the panel of the attachment of a rank, on a page that changes them in panels; their fields open otherwise. */
  readonly attachmentPanel?: (rank: number) => string;
}): ReactNode {
  const at = `/knowledge/${rank}`;
  const title = source.id === "" ? t("configuration.knowledge.untitled", { rank: rank + 1 }) : source.id;
  return (
    <Card
      title={named ? title : t(`configuration.knowledge.kinds.${kindOf(source)}`)}
      {...(named ? { hint: t(`configuration.knowledge.kinds.${kindOf(source)}`) } : {})}
      {...(removable ? { aside: <RemoveButton pointer={at} label={t("configuration.knowledge.removeSource", { name: title })} /> } : {})}
    >
      <div className="config-body">
        <PlaceErrors pointer={at} />
        <div className="config-fields">
          <InputField pointer={`${at}/id`} label={t("configuration.application.id")} value={source.id} code hint={t("configuration.application.idHint")} />
          <WhereFields at={at} source={source} documentsLink={documentsLink} />
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
          <ChoiceField
            pointer={`${at}/attachments`}
            kind="reach"
            label={t("configuration.knowledge.reach")}
            hint={t(isProjectWide(source) ? "configuration.knowledge.reachProjectHint" : "configuration.knowledge.reachApplicationsHint")}
            value={isProjectWide(source) ? "project" : "applications"}
            options={choices(["project", "applications"], (value) => t(`configuration.knowledge.reaches.${value}`))}
          />
          <Attachments at={at} source={source} owner={title} applications={applications} panelOf={attachmentPanel} />
        </fieldset>
      </div>
    </Card>
  );
}

/** The picture of each kind of source: a contract, a base, documents, code, logs. */
export const KIND_ICONS: Readonly<Record<SourceKind, IconName>> = {
  openapi: "api",
  postgresql: "database",
  document: "document",
  stored: "document",
  "source-code": "code",
  logs: "data",
};

/**
 * The buttons that add a source of each kind.
 *
 * @param props - The kinds offered, in their order; every kind by default.
 * @returns Them.
 */
export function AddSourceButtons({ kinds = SOURCE_KINDS }: { readonly kinds?: readonly SourceKind[] }): ReactNode {
  return (
    <div className="tiles">
      {kinds.map((kind) => (
        <AddButton key={kind} pointer="/knowledge" item={kind} className="tile" label={t(`configuration.knowledge.add.${kind}`)}>
          <span className="tile-head">
            <span className="knowledge-kind">
              <Icon name={KIND_ICONS[kind]} />
            </span>
            <b>{t(`configuration.knowledge.kinds.${kind}`)}</b>
          </span>
          <span className="tile-text">{t(`configuration.knowledge.explain.${kind}`)}</span>
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
