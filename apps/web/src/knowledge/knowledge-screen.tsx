import type { FormEventHandler, MouseEventHandler, ReactNode } from "react";
import {
  DOCUMENT_EXTENSIONS,
  attachmentsOf,
  isProjectWide,
  isStoredDocuments,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENTS_PER_UPLOAD,
  type Attachment,
  type ConfiguredApplication,
  type Knowledge,
  type StoredDocumentSummary,
  type CartographyState,
  type MappedSource,
  type MappingState,
  type OqasConfig,
} from "@open-qa-stack/domain/sessions";
import { EditContext } from "../configuration/configuration-edit.ts";
import { rankIn } from "../configuration/use-item-pages.ts";
import type { ConfigurationControls } from "../configuration/configuration-screen.tsx";
import type { ConfigurationState } from "../configuration/configuration-state.ts";
import { AddSourceButtons, KIND_ICONS, kindOf } from "../configuration/knowledge-card.tsx";
import { errorText } from "../configuration/configuration-words.ts";
import { dateText, sizeText } from "../i18n/formats.ts";
import { t } from "../i18n/i18n.ts";
import { hrefTo, type Route } from "../routing/route.ts";
import { Badge, type BadgeTone } from "../ui/badge.tsx";
import { Icon } from "../ui/icon.tsx";
import { Card } from "../ui/card.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { Page, type Crumb } from "../ui/page.tsx";
import type { KnowledgeState, Refusal } from "./knowledge-state.ts";
import { SourceEditor } from "./source-editor.tsx";

/** The identifier of the input that takes the files of an upload. */
export const FILES_INPUT = "knowledge-files";

/** What the person does on the screen of a source. */
export interface KnowledgeControls {
  /** Uploads the files of the form. */
  readonly upload: FormEventHandler<HTMLFormElement>;
  /** Removes the document the button names, once the person confirmed it. */
  readonly remove: MouseEventHandler<HTMLButtonElement>;
  /** What the person does to the draft of the configuration, which holds the sources. */
  readonly edit: ConfigurationControls;
  /** Removes the source the button names by its rank from the configuration, once the person confirmed it. */
  readonly drop: MouseEventHandler<HTMLButtonElement>;
}

/** What the screens of the knowledge are drawn from. */
export interface KnowledgeScreenProps {
  /** The name of the project. */
  readonly project: string;
  /** Where the console is: the knowledge, or one of its sources, with the document it reads or asks to remove. */
  readonly route: Route;
  readonly state: KnowledgeState;
  /** The draft of the configuration, in which the person adds, changes and removes a source. */
  readonly editing: ConfigurationState;
  readonly controls: KnowledgeControls;
}

/** The address of the knowledge. */
const KNOWLEDGE = "/knowledge";

/** The address of a source, whose identifier is a slug. */
export const sourcePath = (source: string): string => `${KNOWLEDGE}/${source}`;

/**
 * Tells the rank of a source in the configuration in force, which is its rank in the draft.
 *
 * @param editing - The draft of the configuration.
 * @param id - The identifier of the source.
 * @returns Its rank; `undefined` while the instance did not tell the configuration, and for a source it does not declare.
 */
export function rankOf(editing: ConfigurationState, id: string): number | undefined {
  return rankIn(editing.view, (document: OqasConfig) => document.knowledge, id);
}

/** The number of sources of the configuration in force, which a source added follows: a source is added to a configuration in force. */
const inForceCount = (editing: ConfigurationState): number => editing.view!.revision!.document.knowledge.length;

/**
 * Says where a source is read from: its address, its file, its folder, its container or the variable of its
 * connection, never a secret.
 *
 * @param source - The source.
 * @returns Where it is read from; nothing for documents the instance keeps, which its kind says.
 */
export function whereOf(source: Knowledge): string | undefined {
  if (isStoredDocuments(source)) return undefined;
  if (source.type === "postgresql") return t("knowledge.variable", { name: source.connectionStringEnv });
  if (source.type === "openapi") return source.url ?? source.path;
  if (source.type === "logs") return source.path ?? t("knowledge.container", { name: source.container });
  return source.path;
}

/** What an attachment narrows a source to within its application: an environment, and an API of it; nothing when it is the whole application. */
function narrowing({ environment, api }: Attachment): string | undefined {
  return environment === undefined ? undefined : [environment, api].filter((part) => part !== undefined).join(" › ");
}

/** What a source is, then where it is read from when its kind does not say it. */
function kindText(source: Knowledge): string {
  const where = whereOf(source);
  const kind = t(`configuration.knowledge.kinds.${kindOf(source)}`);
  return where === undefined ? kind : `${kind} · ${where}`;
}

/** A source in the list of an application: what it is, where it is read from, how many documents it holds, and its mapping while it is not done. */
function SourceRow({
  source,
  attachment,
  documents,
  mapped,
}: {
  readonly source: Knowledge;
  /** What ties the source to the application it is listed under; none for a source of the whole project. */
  readonly attachment?: Attachment;
  readonly documents?: readonly StoredDocumentSummary[];
  /** Where the cartography of the source stands; none for a source it does not read. */
  readonly mapped?: MappedSource;
}): ReactNode {
  const narrowed = attachment === undefined ? undefined : narrowing(attachment);
  return (
    <a className="row knowledge-row" href={hrefTo(sourcePath(source.id))}>
      <span className="knowledge-kind">
        <Icon name={KIND_ICONS[kindOf(source)]} />
      </span>
      <div className="grow">
        <span className="knowledge-id">{source.id}</span>
        <div className="small muted">{kindText(source)}</div>
      </div>
      {narrowed !== undefined && <span className="small muted">{narrowed}</span>}
      {documents !== undefined && <Badge tone="outline">{t("knowledge.documentCount", { count: documents.length })}</Badge>}
      {mapped !== undefined && mapped.state !== "mapped" && <Badge tone={MAPPING_TONES[mapped.state]}>{t(`knowledge.mapping.${mapped.state}`)}</Badge>}
    </a>
  );
}

/** The tone of the badge of where the cartography of a source stands. */
export const MAPPING_TONES: Readonly<Record<MappingState, BadgeTone>> = { waiting: "outline", mapping: "ai", mapped: "ok", truncated: "warn" };

/** Where the index of the knowledge stands: written, when, and whether in part; or not yet. */
export function IndexLine({ mapping }: { readonly mapping: CartographyState | undefined }): ReactNode {
  if (mapping === undefined) return null;
  const { index } = mapping;
  return (
    <p className="small muted" role="status">
      {index === undefined
        ? t("knowledge.mapping.noIndex")
        : t(index.status === "complete" ? "knowledge.mapping.index" : "knowledge.mapping.partIndex", { date: dateText(index.producedAt) })}
    </p>
  );
}

/** The source the person adds: the kinds to choose from, then the source of the kind chosen, to fill in and save. */
function Adder({ route, editing, controls }: { readonly route: Route; readonly editing: ConfigurationState; readonly controls: KnowledgeControls }): ReactNode {
  const rank = inForceCount(editing);
  if (editing.draft !== undefined && editing.draft.knowledge.length > rank)
    return <SourceEditor state={editing} controls={controls.edit} rank={rank} route={route} removable />;
  return (
    <Card title={t("knowledge.add")} hint={t("knowledge.addHint")}>
      <div className="config-body">
        <EditContext.Provider value={{ change: controls.edit.change, click: controls.edit.click, errors: [], values: {} }}>
          <AddSourceButtons />
        </EditContext.Provider>
      </div>
    </Card>
  );
}

/** The sources of the configuration, application after application: a source attached to several is listed under each. */
function Overview({ project, route, state, editing, controls }: KnowledgeScreenProps): ReactNode {
  const title = t("knowledge.title");
  // A source is added to a configuration in force; an instance without one is set up first.
  const configured = editing.view?.revision !== undefined;
  const action = configured ? (
    <a className="btn primary" href={hrefTo(KNOWLEDGE, { add: "source" })}>
      {t("knowledge.add")}
    </a>
  ) : (
    <a className="btn" href={hrefTo("/configuration")}>
      {t("knowledge.configure")}
    </a>
  );
  const { configuration } = state;
  const sources = configuration?.knowledge ?? [];
  const adding = configured && route.query["add"] !== undefined;
  return (
    <Page
      crumbs={[{ label: project }, { label: title }]}
      title={title}
      {...(adding ? {} : { actions: action })}
      {...(state.read && sources.length > 0 ? { hint: t("knowledge.lead") } : {})}
    >
      {adding && <Adder route={route} editing={editing} controls={controls} />}
      {!state.read ? (
        <EmptyState title={t("knowledge.reading")}>
          <span role="status">{state.unread ?? t("knowledge.readingNote")}</span>
        </EmptyState>
      ) : sources.length === 0 ? (
        <EmptyState title={t("knowledge.none")} {...(adding ? {} : { action })}>
          {t("knowledge.noneNote")}
        </EmptyState>
      ) : (
        <>
          <IndexLine mapping={state.mapping} />
          <ProjectSources sources={sources} state={state} />
          {configuration!.applications.map((application) => (
            <ApplicationSources key={application.id} application={application} sources={sources} state={state} />
          ))}
        </>
      )}
    </Page>
  );
}

/** The sources of the whole project, which every session reads; nothing when there is none. */
function ProjectSources({ sources, state }: { readonly sources: readonly Knowledge[]; readonly state: KnowledgeState }): ReactNode {
  const wide = sources.filter(isProjectWide);
  if (wide.length === 0) return null;
  return (
    <Card title={t("knowledge.project")} hint={t("knowledge.projectHint")}>
      {wide.map((source) => (
        <SourceRow
          key={source.id}
          source={source}
          {...(state.documents[source.id] === undefined ? {} : { documents: state.documents[source.id] })}
          {...mappedOf(state.mapping, source.id)}
        />
      ))}
    </Card>
  );
}

/** The sources attached to an application. */
function ApplicationSources({
  application,
  sources,
  state,
}: {
  readonly application: ConfiguredApplication;
  readonly sources: readonly Knowledge[];
  readonly state: KnowledgeState;
}): ReactNode {
  const attached = sources.flatMap((source) =>
    attachmentsOf(source)
      .filter((attachment) => attachment.application === application.id)
      .map((attachment) => ({ source, attachment })),
  );
  return (
    <Card title={application.name} hint={application.id}>
      {attached.length === 0 && <EmptyState title={t("knowledge.noSource")} />}
      {attached.map(({ source, attachment }, index) => (
        <SourceRow
          key={index}
          source={source}
          attachment={attachment}
          {...(state.documents[source.id] === undefined ? {} : { documents: state.documents[source.id] })}
          {...mappedOf(state.mapping, source.id)}
        />
      ))}
    </Card>
  );
}

/** What the person is told of an upload or a removal: on its way, taken, or refused with each error at its file. */
function ChangeNote({ source, state }: { readonly source: string; readonly state: KnowledgeState }): ReactNode {
  const { change } = state;
  if (change === undefined || change.source !== source) return null;
  if (change.state === "sending")
    return (
      <p className="config-note info" role="status">
        {t("knowledge.sending")}
      </p>
    );
  if (change.state === "done")
    return (
      <p className="config-note ok" role="status">
        {change.uploaded === 0 ? t("knowledge.removed") : t("knowledge.uploaded", { count: change.uploaded })}
      </p>
    );
  return <RefusalNote refusal={change.refusal} />;
}

/** A refusal, and the errors of an upload, each with the file it is about. */
function RefusalNote({ refusal }: { readonly refusal: Refusal }): ReactNode {
  const rank = (path: string): number | undefined => (path.startsWith("/documents/") ? Number(path.slice("/documents/".length)) : undefined);
  return (
    <section className="config-note ko" role="alert">
      <b>{refusal.text}</b>
      {refusal.errors.length > 0 && (
        <ul id={`${FILES_INPUT}-errors`}>
          {refusal.errors.map((error, index) => {
            const at = rank(error.path);
            const name = at === undefined ? undefined : refusal.names[at];
            return (
              <li key={index}>
                {name !== undefined && <code className="mono">{name}</code>} {errorText(error)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The documents of a source the instance keeps: each to read or remove, the confirmation of a removal asked, and the form of an upload. */
function StoredDocuments({
  source,
  route,
  state,
  controls,
}: {
  readonly source: string;
  readonly route: Route;
  readonly state: KnowledgeState;
  readonly controls: KnowledgeControls;
}): ReactNode {
  const documents = state.documents[source];
  const asked = route.query["remove"];
  const sending = state.change?.source === source && state.change.state === "sending";
  const refused = state.change?.source === source && state.change.state === "refused" && state.change.refusal.errors.length > 0;
  const here = sourcePath(source);
  return (
    <>
      <Card title={t("knowledge.documents")} hint={t("knowledge.documentsHint")}>
        {documents === undefined && <EmptyState title={t("knowledge.listing")} />}
        {documents?.length === 0 && <EmptyState title={t("knowledge.noDocument")}>{t("knowledge.noDocumentNote")}</EmptyState>}
        {documents?.map((document) => (
          <div key={document.name} className="row knowledge-document">
            <div className="grow">
              <a className="mono knowledge-name" href={hrefTo(here, { document: document.name })}>
                {document.name}
              </a>
              <div className="small muted">
                {sizeText(document.bytes)} · <time dateTime={document.uploadedAt}>{dateText(document.uploadedAt)}</time>
              </div>
            </div>
            <a className="btn sm ghost" href={hrefTo(here, { remove: document.name })} aria-label={t("knowledge.removeNamed", { name: document.name })}>
              {t("knowledge.remove")}
            </a>
          </div>
        ))}
        {asked !== undefined && documents?.some((document) => document.name === asked) === true && (
          <section className="config-note warn knowledge-confirm" aria-labelledby="knowledge-confirm-title">
            <b id="knowledge-confirm-title">{t("knowledge.confirmTitle", { name: asked })}</b>
            <span>{t("knowledge.confirmNote")}</span>
            <div className="config-actions">
              <a className="btn" href={hrefTo(here)}>
                {t("knowledge.cancel")}
              </a>
              <button type="button" className="btn danger" data-source={source} data-name={asked} onClick={controls.remove} disabled={sending}>
                {t("knowledge.confirmRemove")}
              </button>
            </div>
          </section>
        )}
      </Card>
      <ChangeNote source={source} state={state} />
      <Card title={t("knowledge.upload")}>
        <form className="config-body" data-source={source} onSubmit={controls.upload} noValidate>
          <div className="config-field">
            <label htmlFor={FILES_INPUT}>{t("knowledge.files")}</label>
            <input
              id={FILES_INPUT}
              name="documents"
              type="file"
              multiple
              accept={[...DOCUMENT_EXTENSIONS, "text/markdown"].join(",")}
              aria-invalid={refused}
              aria-describedby={refused ? `${FILES_INPUT}-hint ${FILES_INPUT}-errors` : `${FILES_INPUT}-hint`}
            />
            <span id={`${FILES_INPUT}-hint`} className="field-hint">
              {t("knowledge.filesHint", { size: sizeText(MAX_DOCUMENT_BYTES), count: MAX_DOCUMENTS_PER_UPLOAD })}
            </span>
          </div>
          <div className="config-actions">
            <button type="submit" className="btn primary" disabled={sending}>
              {sending ? t("knowledge.sending") : t("knowledge.send")}
            </button>
          </div>
        </form>
      </Card>
    </>
  );
}

/** The document the person reads: its text as the instance keeps it, or why it could not be read. */
function OpenedDocument({ source, name, state }: { readonly source: string; readonly name: string; readonly state: KnowledgeState }): ReactNode {
  const { opened } = state;
  const shown = opened !== undefined && "text" in opened && opened.name === name ? opened : undefined;
  const failed = opened !== undefined && "unread" in opened && opened.source === source && opened.name === name ? opened.unread : undefined;
  return (
    <Card
      title={<span className="mono">{name}</span>}
      hint={t("knowledge.readOnly")}
      aside={
        <a className="btn sm ghost" href={hrefTo(sourcePath(source))}>
          {t("knowledge.close")}
        </a>
      }
    >
      {shown !== undefined ? (
        <pre className="mono knowledge-text">{shown.text}</pre>
      ) : (
        <EmptyState title={t("knowledge.opening")}>
          <span role={failed === undefined ? "status" : "alert"}>{failed ?? t("knowledge.openingNote")}</span>
        </EmptyState>
      )}
    </Card>
  );
}

/** A source: what it is and what it is attached to; for one whose documents the instance keeps, its documents. */
/** The confirmation of the removal of a source the person asked for, with the ways out. */
function DropConfirmation({
  id,
  rank,
  editing,
  controls,
}: {
  readonly id: string;
  readonly rank: number;
  readonly editing: ConfigurationState;
  readonly controls: KnowledgeControls;
}): ReactNode {
  return (
    <section className="config-note warn knowledge-confirm" aria-labelledby="knowledge-drop-title">
      <b id="knowledge-drop-title">{t("knowledge.dropTitle", { id })}</b>
      <span>{t("knowledge.dropNote")}</span>
      <div className="config-actions">
        <a className="btn" href={hrefTo(sourcePath(id))}>
          {t("knowledge.cancel")}
        </a>
        <button type="button" className="btn danger" data-rank={rank} onClick={controls.drop} disabled={editing.saving}>
          {t("knowledge.confirmDrop")}
        </button>
      </div>
    </section>
  );
}

function SourceScreen({ project, route, state, editing, controls, id }: KnowledgeScreenProps & { readonly id: string }): ReactNode {
  const crumbs: Crumb[] = [{ label: project }, { label: t("knowledge.title"), href: hrefTo(KNOWLEDGE) }, { label: id }];
  const source = state.configuration?.knowledge.find((candidate) => candidate.id === id);
  if (source === undefined)
    return (
      <Page crumbs={crumbs} title={id}>
        <EmptyState title={state.read ? t("knowledge.unknown") : t("knowledge.reading")} action={<a href={hrefTo(KNOWLEDGE)}>{t("knowledge.back")}</a>}>
          <span role="status">{state.read ? t("knowledge.unknownNote") : (state.unread ?? t("knowledge.readingNote"))}</span>
        </EmptyState>
      </Page>
    );
  const reading = route.query["document"];
  const rank = rankOf(editing, id);
  const drop =
    rank === undefined ? undefined : (
      <a className="btn ghost" href={hrefTo(sourcePath(id), { drop: "source" })}>
        {t("knowledge.drop")}
      </a>
    );
  return (
    <Page crumbs={crumbs} title={id} {...(drop === undefined ? {} : { actions: drop })}>
      {rank !== undefined && route.query["drop"] !== undefined && <DropConfirmation id={id} rank={rank} editing={editing} controls={controls} />}
      {rank !== undefined && editing.draft !== undefined ? (
        <SourceEditor state={editing} controls={controls.edit} rank={rank} route={route} />
      ) : (
        <Card title={kindText(source)}>
          {isProjectWide(source) && <p className="row">{t("knowledge.project")}</p>}
          {attachmentsOf(source).map((attachment, index) => (
            <div key={index} className="row">
              <span className="grow">{attachment.application}</span>
              <span className="small muted">{narrowing(attachment) ?? t("knowledge.everywhere")}</span>
            </div>
          ))}
        </Card>
      )}
      <p className="small muted">{isStoredDocuments(source) ? t("knowledge.storedNote") : t("knowledge.readThere")}</p>
      {isStoredDocuments(source) && <StoredDocuments source={id} route={route} state={state} controls={controls} />}
      {isStoredDocuments(source) && reading !== undefined && <OpenedDocument source={id} name={reading} state={state} />}
    </Page>
  );
}

/**
 * The knowledge of the project: its sources, application after application, each leading to what it is and, for the
 * documents the instance keeps, to its documents, which the person reads, uploads and removes.
 *
 * @param props - The project, the route, the state of the screens and what the person does on them.
 * @returns The screen of the route.
 */
export function KnowledgeScreen(props: KnowledgeScreenProps): ReactNode {
  const [, id] = props.route.path;
  return id === undefined ? <Overview {...props} /> : <SourceScreen {...props} id={id} />;
}

/** Where the cartography of a source stands, as the props of its row: none before the instance told it, nor for a source it does not read. */
function mappedOf(mapping: CartographyState | undefined, id: string): { readonly mapped?: MappedSource } {
  const mapped = mapping?.sources.find((source) => source.id === id);
  return mapped === undefined ? {} : { mapped };
}
