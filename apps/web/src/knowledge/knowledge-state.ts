import type {
  ConfigError,
  ConfigurationView,
  OqasConfig,
  ProblemCode,
  StoredDocument,
  StoredDocumentSummary,
  CartographyState,
} from "@open-qa-stack/domain/sessions";

/** Why the instance refused what the person asked, in their words, with the errors of an upload, each at its file. */
export interface Refusal {
  readonly code: ProblemCode | "unreachable";
  readonly text: string;
  /** For an upload, every error, `/documents/<rank>` in the order of the files, or `""` for the upload. */
  readonly errors: readonly ConfigError[];
  /** For an upload, the names of its files, in its order, which name the files the errors are about. */
  readonly names: readonly string[];
}

/** Where an upload, or a removal, of the documents of a source is. */
export type DocumentChange =
  /** On its way to the instance. */
  | { readonly source: string; readonly state: "sending" }
  /** Taken: how many documents an upload brought, none for a removal. */
  | { readonly source: string; readonly state: "done"; readonly uploaded: number }
  /** Refused. */
  | { readonly source: string; readonly state: "refused"; readonly refusal: Refusal };

/** What the screens of the knowledge hold: what the instance told of the sources, of their documents, and the change the person is making. */
export interface KnowledgeState {
  /** The configuration in force, which declares the sources; `undefined` before the instance told it, or when it has none. */
  readonly configuration?: OqasConfig;
  /** Whether the instance told the configuration. */
  readonly read: boolean;
  /** Why the instance could not tell it, when it answered so. */
  readonly unread?: string;
  /** The documents of each source the instance keeps, by its identifier, once the instance listed them. */
  readonly documents: Readonly<Record<string, readonly StoredDocumentSummary[]>>;
  /** The document the person reads, once the instance told it; or why it could not. */
  readonly opened?: StoredDocument | { readonly source: string; readonly name: string; readonly unread: string };
  /** The last upload or removal the person asked for. */
  readonly change?: DocumentChange;
  /** Where the cartography of the knowledge stands, once the instance told it. */
  readonly mapping?: CartographyState;
}

/** What changes the state of the screens. */
export type KnowledgeAction =
  /** The instance told the configuration in force. */
  | { readonly type: "read"; readonly view: ConfigurationView }
  /** The instance could not tell it. */
  | { readonly type: "unread"; readonly message: string }
  /** The instance told where the cartography of the knowledge stands. */
  | { readonly type: "mapped"; readonly mapping: CartographyState }
  /** The instance listed the documents of a source. */
  | { readonly type: "listed"; readonly source: string; readonly items: readonly StoredDocumentSummary[] }
  /** The instance told a document. */
  | { readonly type: "opened"; readonly document: StoredDocument }
  /** The instance could not tell it. */
  | { readonly type: "unopened"; readonly source: string; readonly name: string; readonly message: string }
  /** An upload or a removal left for the instance. */
  | { readonly type: "sending"; readonly source: string }
  /** The instance took it, and listed the documents of the source as they are now. */
  | { readonly type: "changed"; readonly source: string; readonly items: readonly StoredDocumentSummary[]; readonly uploaded: number }
  /** The console or the instance refused it. */
  | { readonly type: "refused"; readonly source: string; readonly refusal: Refusal };

/** The state of the screens before the instance told anything. */
export const INITIAL_KNOWLEDGE: KnowledgeState = { read: false, documents: {} };

/**
 * Gives the state of the screens after an action.
 *
 * @param state - The state before.
 * @param action - What happened.
 * @returns The state after.
 */
export function knowledgeAfter(state: KnowledgeState, action: KnowledgeAction): KnowledgeState {
  switch (action.type) {
    case "read": {
      const { unread: _, configuration: __, ...rest } = state;
      const document = action.view.revision?.document;
      return { ...rest, read: true, ...(document === undefined ? {} : { configuration: document }) };
    }
    case "unread":
      return { ...state, unread: action.message };
    case "mapped":
      return { ...state, mapping: action.mapping };
    case "listed":
      return { ...state, documents: { ...state.documents, [action.source]: action.items } };
    case "opened":
      return { ...state, opened: action.document };
    case "unopened":
      return { ...state, opened: { source: action.source, name: action.name, unread: action.message } };
    case "sending":
      return { ...state, change: { source: action.source, state: "sending" } };
    case "changed":
      return {
        ...state,
        documents: { ...state.documents, [action.source]: action.items },
        change: { source: action.source, state: "done", uploaded: action.uploaded },
      };
    case "refused":
      return { ...state, change: { source: action.source, state: "refused", refusal: action.refusal } };
  }
}
