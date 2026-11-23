import { isStoredDocuments, uploadErrors, type StoredDocumentSummary } from "@open-qa-stack/domain/sessions";
import type { ApiClient } from "../api/api-client.ts";
import type { ApiError } from "../api/api-error.ts";
import { poll } from "../api/poll.ts";
import { t } from "../i18n/i18n.ts";
import type { KnowledgeAction } from "./knowledge-state.ts";

/** How long the screens wait between an answer of the API and the next time they read the knowledge, in milliseconds. */
export const READ_PAUSE_MS = 2000;

/**
 * What keeps the screens of the knowledge in step with their instance: it reads the configuration in force and the
 * documents of the sources it keeps, reads a document, uploads documents and removes one, and tells the state what
 * came back.
 */
export class KnowledgeSync {
  readonly #api: ApiClient;
  readonly #dispatch: (action: KnowledgeAction) => void;

  /**
   * @param api - The API of the instance.
   * @param dispatch - What applies an action to the state of the screens.
   */
  public constructor(api: ApiClient, dispatch: (action: KnowledgeAction) => void) {
    this.#api = api;
    this.#dispatch = dispatch;
  }

  /**
   * Reads the configuration in force and the documents of each source it declares stored, again and again: the
   * screens show when another person changed them.
   *
   * @returns What stops reading them.
   */
  public read(): () => void {
    return poll(
      {
        ask: async () => {
          const view = await this.#api.configuration();
          const sources = (view.revision?.document.knowledge ?? []).filter(isStoredDocuments).map((source) => source.id);
          const [lists, mapping] = await Promise.all([
            Promise.all(sources.map(async (source) => [source, await this.#api.documents(source)] as const)),
            this.#api.mapping(),
          ]);
          return { view, lists, mapping };
        },
        told: ({ view, lists, mapping }) => {
          this.#dispatch({ type: "mapped", mapping });
          this.#dispatch({ type: "read", view });
          for (const [source, items] of lists) this.#dispatch({ type: "listed", source, items });
        },
        failed: (error) => this.#dispatch({ type: "unread", message: error.message }),
      },
      READ_PAUSE_MS,
    );
  }

  /**
   * Reads a document, and tells it.
   *
   * @param source - The identifier of its source.
   * @param name - Its file name.
   */
  public open(source: string, name: string): void {
    this.#api.document(source, name).then(
      (document) => this.#dispatch({ type: "opened", document }),
      (error: ApiError) => this.#dispatch({ type: "unopened", source, name, message: error.message }),
    );
  }

  /**
   * Uploads files to a source, once the console found them in order by the rules of an upload: what breaks one is
   * refused at once, each error at its file, and nothing leaves.
   *
   * @param source - The identifier of the source.
   * @param files - The files the person chose.
   */
  public upload(source: string, files: readonly File[]): void {
    const names = files.map((file) => file.name);
    const errors = uploadErrors(files.map(({ name, size }) => ({ name, bytes: size })));
    if (errors.length > 0) {
      this.#dispatch({ type: "refused", source, refusal: { code: "invalid_documents", text: t("problems.invalid_documents"), errors, names } });
      return;
    }
    this.#settle(source, names, this.#api.upload(source, files), files.length);
  }

  /**
   * Removes a document of a source.
   *
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   */
  /**
   * Asks the instance to map the knowledge again, the source named or every source, and tells what came of it; the
   * cartography then goes on as the polling tells it.
   *
   * @param source - The identifier of the source; every source when none is named.
   */
  public remap(source?: string): void {
    const named = source === undefined ? {} : { source };
    this.#dispatch({ type: "remapping", ...named });
    this.#api.remap(source).then(
      (outcome) => this.#dispatch({ type: "remapped", ...named, outcome }),
      (error: ApiError) => this.#dispatch({ type: "remapped", ...named, failure: error.message }),
    );
  }

  public remove(source: string, name: string): void {
    this.#settle(
      source,
      [],
      this.#api.removeDocument(source, name).then(() => this.#api.documents(source)),
      0,
    );
  }

  /** Tells the state that a change left, then what the instance answered. */
  #settle(source: string, names: readonly string[], answer: Promise<readonly StoredDocumentSummary[]>, uploaded: number): void {
    this.#dispatch({ type: "sending", source });
    answer.then(
      (items) => this.#dispatch({ type: "changed", source, items, uploaded }),
      (error: ApiError) => this.#dispatch({ type: "refused", source, refusal: { code: error.code, text: error.message, errors: error.errors, names } }),
    );
  }
}
