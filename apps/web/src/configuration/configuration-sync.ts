import type { ConfigurationView, Knowledge, Model, OqasConfig } from "@open-qa-stack/domain/sessions";
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
   * Reads the configuration, its revisions and where the values of its variables come from, again and again: the
   * screen shows when the file or another person changed them.
   *
   * @returns What stops reading them.
   */
  public read(): () => void {
    return poll(
      {
        ask: () => Promise.all([this.#api.configuration(), this.#api.revisions(), this.#api.secrets()]),
        told: ([view, revisions, secrets]) => {
          this.#dispatch({ type: "read", view, revisions });
          this.#dispatch({ type: "secrets", secrets });
        },
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
   * Tests the connection to the model the draft names, and tells what the instance found.
   *
   * @param model - The section `model` of the draft.
   * @param key - The key the person typed for the variable of the model, and did not save yet.
   */
  public testModel(model: Model, key?: string): void {
    this.#dispatch({ type: "testing", model });
    this.#api.testModel(model, key).then(
      (check) => this.#dispatch({ type: "tested", model, check }),
      (error: ApiError) => this.#dispatch({ type: "tested", model, failure: error.message }),
    );
  }

  /**
   * Tests that a knowledge source of the draft answers, and tells what the instance found.
   *
   * @param rank - The rank of the source in the draft.
   * @param source - The source.
   * @param value - The connection string the person typed for a database, and did not save yet.
   */
  public checkSource(rank: number, source: Knowledge, value?: string): void {
    this.#dispatch({ type: "sourceChecking", rank, source });
    this.#api.checkSource(source, value).then(
      (check) => this.#dispatch({ type: "sourceChecked", rank, source, check }),
      (error: ApiError) => this.#dispatch({ type: "sourceChecked", rank, source, failure: error.message }),
    );
  }

  /** Reads where the test repository stands, for a person who sets it up; a reading that fails tells nothing. */
  public readRepository(): void {
    this.#api.repository().then(
      (repository) => this.#dispatch({ type: "repository", repository }),
      () => undefined,
    );
  }

  /**
   * Saves the first configuration of an instance that has none, which writes its file, and the values the person
   * typed for its variables, then sets the test repository up: a Playwright project, and a git repository with a
   * commit of a folder that is none.
   *
   * @param document - The configuration as the person set it up.
   * @param values - The values typed, by the name of their variable.
   */
  public setUp(document: OqasConfig, values: Readonly<Record<string, string>>): void {
    this.#settle(this.#api.save({ basedOn: 0, document }), async () => {
      if (!(await this.#saveValues(values))) return;
      await this.#api.prepareRepository().then(
        (preparation) => this.#dispatch({ type: "prepared", preparation }),
        (error: ApiError) => this.#refused(error),
      );
    });
  }

  /**
   * Saves a change, made from a revision, then the values the person typed for the variables it names: the values
   * alone when the configuration did not change.
   *
   * @param document - The configuration as it is to be; `undefined` when it did not change.
   * @param basedOn - The number of the revision it was made from.
   * @param values - The values typed, by the name of their variable.
   */
  public save(document: OqasConfig | undefined, basedOn: number, values: Readonly<Record<string, string>>): void {
    const saveValues = (): Promise<boolean> => this.#saveValues(values);
    if (document !== undefined) this.#settle(this.#api.save({ basedOn, document }), saveValues);
    else {
      this.#dispatch({ type: "saving" });
      void saveValues();
    }
  }

  /** Takes the configuration file as it is now as the revision in force. */
  public takeFile(): void {
    this.#settle(this.#api.synchronise());
  }

  /** Writes the revision in force to the configuration file. */
  public writeFile(): void {
    this.#settle(this.#api.writeFile());
  }

  /**
   * Saves the values typed, one after the other, but those of the variables the environment of the instance sets, which
   * win; then tells the state where each variable stands. Nothing is asked when none was typed.
   *
   * @returns Whether every value was saved.
   */
  async #saveValues(values: Readonly<Record<string, string>>): Promise<boolean> {
    const typed = Object.entries(values);
    if (typed.length === 0) return true;
    try {
      // A person who set the instance up typed values before it could tell which variables its environment sets.
      const set = new Set((await this.#api.secrets()).filter(({ source }) => source === "environment").map(({ name }) => name));
      for (const [name, value] of typed) if (!set.has(name)) await this.#api.saveSecret(name, value);
      this.#dispatch({ type: "valued", secrets: await this.#api.secrets() });
      return true;
    } catch (error) {
      this.#refused(error as ApiError);
      return false;
    }
  }

  /** Tells the state the instance refused what was asked. */
  #refused(error: ApiError): void {
    this.#dispatch({ type: "refused", code: error.code, text: error.message, errors: error.errors });
  }

  /**
   * Tells the state that a request left, then what the instance answered, and lists the revisions again once it took it.
   *
   * @param then - What to do once the instance took it; nothing by default.
   */
  #settle(answer: Promise<ConfigurationView>, then: () => unknown = () => undefined): void {
    this.#dispatch({ type: "saving" });
    answer.then(
      (view) => {
        this.#dispatch({ type: "saved", view });
        then();
        this.#api.revisions().then(
          (revisions) => this.#dispatch({ type: "listed", revisions }),
          () => undefined,
        );
      },
      (error: ApiError) => this.#refused(error),
    );
  }
}
