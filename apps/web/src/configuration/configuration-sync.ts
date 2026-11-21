import type { ConfigurationView, Model, OqasConfig } from "@open-qa-stack/domain/sessions";
import type { ApiClient } from "../api/api-client.ts";
import type { ApiError } from "../api/api-error.ts";
import { poll } from "../api/poll.ts";
import type { ConfigurationAction } from "./configuration-state.ts";

/** How long the screen waits between an answer of the API and the next time it reads the configuration, in milliseconds. */
export const READ_PAUSE_MS = 2000;

/**
 * What keeps the screen of the configuration in step with its instance: it reads the configuration and its
 * revisions, has a draft checked, saves a change or takes the file, and tells the state what came back.
 */
export class ConfigurationSync {
  readonly #api: ApiClient;
  readonly #dispatch: (action: ConfigurationAction) => void;

  /**
   * @param api - The API of the instance.
   * @param dispatch - What applies an action to the state of the screen.
   */
  public constructor(api: ApiClient, dispatch: (action: ConfigurationAction) => void) {
    this.#api = api;
    this.#dispatch = dispatch;
  }

  /**
   * Reads the configuration and its revisions, again and again: the screen shows when the file or another person
   * changed them.
   *
   * @returns What stops reading them.
   */
  public read(): () => void {
    return poll(
      {
        ask: () => Promise.all([this.#api.configuration(), this.#api.revisions()]),
        told: ([view, revisions]) => this.#dispatch({ type: "read", view, revisions }),
        failed: (error) => this.#dispatch({ type: "unread", message: error.message }),
      },
      READ_PAUSE_MS,
    );
  }

  /**
   * Has the instance check a draft, and tells what it found; a check that fails is let go: the save tells why.
   *
   * @param draft - The configuration as the person is changing it.
   */
  public check(draft: OqasConfig): void {
    this.#api.check(draft).then(
      (errors) => this.#dispatch({ type: "checked", draft, errors }),
      () => undefined,
    );
  }

  /**
   * Saves a change, made from a revision.
   *
   * @param document - The configuration as it is to be.
   * @param basedOn - The number of the revision it was made from.
   * @param replaceFile - Whether the change rewrites a file that changed too.
   */
  /**
   * Tests the connection to the model the draft names, and tells what the instance found.
   *
   * @param model - The section `model` of the draft.
   */
  public testModel(model: Model): void {
    this.#dispatch({ type: "testing", model });
    this.#api.testModel(model).then(
      (check) => this.#dispatch({ type: "tested", model, check }),
      (error: ApiError) => this.#dispatch({ type: "tested", model, failure: error.message }),
    );
  }

  public save(document: OqasConfig, basedOn: number, replaceFile: boolean): void {
    this.#settle(this.#api.save({ basedOn, document, ...(replaceFile ? { replaceFile } : {}) }));
  }

  /** Takes the configuration file as it is now as the revision in force. */
  public keepFile(): void {
    this.#settle(this.#api.synchronise());
  }

  /** Tells the state that a request left, then what the instance answered, and lists the revisions again once it took it. */
  #settle(answer: Promise<ConfigurationView>): void {
    this.#dispatch({ type: "saving" });
    answer.then(
      (view) => {
        this.#dispatch({ type: "saved", view });
        this.#api.revisions().then(
          (revisions) => this.#dispatch({ type: "listed", revisions }),
          () => undefined,
        );
      },
      (error: ApiError) => this.#dispatch({ type: "refused", code: error.code, text: error.message, errors: error.errors }),
    );
  }
}
