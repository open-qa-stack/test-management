import type { MessageReceipt, Problem, Project, Session, SessionList, SessionMessage, SessionOpening } from "@open-qa-stack/domain/sessions";
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
  return new ApiError(problemText(code, problem?.detail), response.status, code);
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

  async #ask<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${API_BASE}${path}`, init);
    } catch {
      throw new ApiError("L’instance ne répond pas.", 0, "unreachable");
    }
    if (!response.ok) throw await failureOf(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError("La réponse de l’instance est illisible.", response.status, "error");
    }
  }
}
