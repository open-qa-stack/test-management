import type {
  ConfigError,
  ConfigurationCheck,
  ConfigurationView,
  MessageReceipt,
  OqasConfig,
  Problem,
  Project,
  RevisionChange,
  RevisionList,
  RevisionSummary,
  Session,
  SessionList,
  SessionMessage,
  SessionOpening,
} from "@open-qa-stack/domain/sessions";
import { ApiError } from "./api-error.ts";
import { problemCode, problemText } from "./problem-text.ts";

/** The path the console reaches the API of its instance under. */
export const API_BASE = "/api";

/** How the console reaches the network: the `fetch` of the browser, or a double in a test. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What a call that posts a JSON body is made with. */
function posting(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** The error an answer that is not a success stands for: its problem when it carries one, worded for the person. */
async function failureOf(response: Response): Promise<ApiError> {
  const problem = (await response.json().catch(() => undefined)) as Partial<Record<keyof Problem, unknown>> | null | undefined;
  const code = problemCode(problem?.code);
  const errors = Array.isArray(problem?.errors) ? (problem.errors as ConfigError[]) : [];
  return new ApiError(problemText(code, problem?.detail), response.status, code, errors);
}

/**
 * The API of the instance, as the console calls it. Every failure is an {@link ApiError}: an answer that is
 * not a success carries its status and the code of its problem, a success that cannot be read its status and
 * the code `error`, an instance that cannot be reached the status `0` and the code `unreachable`.
 */
export class ApiClient {
  readonly #fetch: Fetch;

  /**
   * @param fetch - How the client reaches the network.
   */
  public constructor(fetch: Fetch) {
    this.#fetch = fetch;
  }

  /** @returns The project of the instance. */
  public project(): Promise<Project> {
    return this.#ask<Project>("/project");
  }

  /** @returns The sessions of the project, the latest first. */
  public async sessions(): Promise<readonly Session[]> {
    return (await this.#ask<SessionList>("/sessions")).items;
  }

  /**
   * Reads one session, whether the list of the project still has it or not.
   *
   * @param id - The identifier of the session.
   * @returns The session; the failure carries the code `unknown_session` when the instance keeps none of that name.
   */
  public session(id: string): Promise<Session> {
    return this.#ask<Session>(`/sessions/${encodeURIComponent(id)}`);
  }

  /**
   * Opens a session.
   *
   * @param opening - What to test.
   * @returns The session opened.
   */
  public open(opening: SessionOpening): Promise<Session> {
    return this.#ask<Session>("/sessions", posting(opening));
  }

  /**
   * Sends a message to the agents of a session that goes on.
   *
   * @param id - The identifier of the session.
   * @param message - What the person says.
   * @returns The receipt of the message; the failure carries the code `session_ended` when the session no longer goes on.
   */
  public say(id: string, message: SessionMessage): Promise<MessageReceipt> {
    return this.#ask<MessageReceipt>(`/sessions/${encodeURIComponent(id)}/messages`, posting(message));
  }

  /**
   * Resumes a session that ended with what the person says more to it, for a new turn of its work.
   *
   * @param id - The identifier of the session.
   * @param message - What the person asks of the new turn.
   * @returns The session, `running` or `queued` for its new turn; the failure carries the code `session_running` when the session goes on.
   */
  public resume(id: string, message: SessionMessage): Promise<Session> {
    return this.#ask<Session>(`/sessions/${encodeURIComponent(id)}/resumption`, posting(message));
  }

  /**
   * Asks the instance to interrupt a session that goes on. The instance takes the request and answers at
   * once: the session ends when the process that runs it obeyed, which its stream tells.
   *
   * @param id - The identifier of the session.
   * @returns Once the request is taken; the failure carries the code `session_ended` when the session no longer goes on.
   */
  public async interrupt(id: string): Promise<void> {
    await this.#answer(`/sessions/${encodeURIComponent(id)}/interruption`, { method: "POST" });
  }

  /** @returns The configuration of the instance as it is now: the revision in force, and how its file stands to it. */
  public configuration(): Promise<ConfigurationView> {
    return this.#ask<ConfigurationView>("/configuration");
  }

  /** @returns The revisions of the configuration, the latest first. */
  public async revisions(): Promise<readonly RevisionSummary[]> {
    return (await this.#ask<RevisionList>("/configuration/revisions")).items;
  }

  /**
   * Checks a configuration, without anything recorded.
   *
   * @param document - The configuration.
   * @returns Every error it holds, each where it is; none when it is valid.
   */
  public async check(document: OqasConfig): Promise<readonly ConfigError[]> {
    return (await this.#ask<ConfigurationCheck>("/configuration/validation", posting(document))).errors;
  }

  /**
   * Saves a change of the configuration, which rewrites its file.
   *
   * @param change - The configuration as it is to be, and the revision it was made from.
   * @returns The configuration as it is now; the failure carries the code `stale_revision`, `configuration_conflict`
   * or `invalid_configuration` with its errors when the instance refuses the change.
   */
  public save(change: RevisionChange): Promise<ConfigurationView> {
    return this.#ask<ConfigurationView>("/configuration/revisions", posting(change));
  }

  /**
   * Takes the file of the configuration as it is now as the revision in force.
   *
   * @returns The configuration as it is now; the failure carries the code `invalid_configuration` with its errors
   * when the file is not valid.
   */
  public synchronise(): Promise<ConfigurationView> {
    return this.#ask<ConfigurationView>("/configuration/synchronisation", { method: "POST" });
  }

  /** The answer of the instance to a call, once it is a success. */
  async #answer(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${API_BASE}${path}`, init);
    } catch {
      throw new ApiError("L’instance ne répond pas.", 0, "unreachable");
    }
    if (!response.ok) throw await failureOf(response);
    return response;
  }

  async #ask<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.#answer(path, init);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("La réponse de l’instance est illisible.", response.status, "error");
    }
  }
}
