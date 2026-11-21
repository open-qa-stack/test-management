import type {
  Campaign,
  CampaignLaunchScope,
  CampaignList,
  CampaignPlan,
  CampaignProgress,
  CampaignTest,
  ConfigError,
  ConfigurationCheck,
  ConfigurationView,
  DocumentList,
  Execution,
  ExecutionList,
  ExecutionQuery,
  KnowledgeDomain,
  KnowledgeDomainList,
  LaunchRequest,
  LaunchState,
  MessageReceipt,
  Model,
  ModelConnectionCheck,
  OqasConfig,
  Problem,
  Project,
  RepositoryPreparation,
  RepositoryState,
  RepositoryTest,
  RepositoryTestList,
  TestExecution,
  TestExecutionList,
  TestLaunch,
  TestReading,
  TestVersion,
  TestVersionList,
  RevisionChange,
  RevisionList,
  RevisionSummary,
  Session,
  SessionList,
  SessionMessage,
  SessionOpening,
  StoredDocument,
  StoredDocumentSummary,
  SecretList,
  SecretState,
} from "@open-qa-stack/domain/sessions";
import { ApiError } from "./api-error.ts";
import { t } from "../i18n/i18n.ts";
import { problemCode, problemText } from "./problem-text.ts";

/** The path the console reaches the API of its instance under. */
export const API_BASE = "/api";

/** How the console reaches the network: the `fetch` of the browser, or a double in a test. */
export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What a call that posts a JSON body is made with. */
function posting(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** The path of the documents of a knowledge source. */
function documentsPath(source: string): string {
  return `/knowledge/${encodeURIComponent(source)}/documents`;
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

  /** @returns Where the test repository of the instance stands: a git repository with a commit, a Playwright project. */
  public async repository(): Promise<RepositoryState> {
    return this.#ask<RepositoryState>("/repository");
  }

  /**
   * Makes a Playwright project of the test repository, from the configuration in force, and a git repository with a
   * commit of a folder that is none.
   *
   * @returns What was written, kept and committed.
   */
  public async prepareRepository(): Promise<RepositoryPreparation> {
    return this.#ask<RepositoryPreparation>("/repository/preparation", { method: "POST" });
  }

  /**
   * Tests a connection to the model as the person drafts it: nothing is saved.
   *
   * @param model - The section `model` of the draft.
   * @param key - The key the person typed and did not save yet; the one the variable holds otherwise.
   * @returns Whether the model answers and what it offers, or why it does not.
   */
  public async testModel(model: Model, key?: string): Promise<ModelConnectionCheck> {
    return this.#ask<ModelConnectionCheck>("/configuration/model-connection", posting(key === undefined ? model : { ...model, key }));
  }

  /** @returns Each variable the configuration in force names, and where its value comes from; never a value. */
  public async secrets(): Promise<readonly SecretState[]> {
    return (await this.#ask<SecretList>("/secrets")).secrets;
  }

  /**
   * Saves the value of a variable the configuration in force names, on the machine of the instance, out of the test
   * repository, in place of the one saved.
   *
   * @param name - The name of the variable.
   * @param value - Its value.
   * @returns Once it is saved; the failure carries the code `unknown_secret` when the configuration does not name it,
   * `secret_refused` when the environment of the instance sets it.
   */
  public async saveSecret(name: string, value: string): Promise<void> {
    await this.#answer(`/secrets/${encodeURIComponent(name)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
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

  /**
   * Lists the tests of the test repository, as their files are now.
   *
   * @returns The tests, in the order of their paths, each with what its tags say of it.
   */
  public async tests(): Promise<readonly RepositoryTest[]> {
    return (await this.#ask<RepositoryTestList>("/tests")).items;
  }

  /**
   * Reads a page of the executions of tests the instance keeps.
   *
   * @param query - What came of their tests, the date they are kept from, and the execution the page starts after; the latest of all when it says nothing.
   * @returns The executions of the page, the latest first, each with what came of each of its tests, how many the query keeps, the rank of the first of the page, and the last one when a page comes after it.
   */
  public executionPage(query: Omit<ExecutionQuery, "limit"> = {}): Promise<ExecutionList> {
    const parameters = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString();
    return this.#ask<ExecutionList>(parameters === "" ? "/executions" : `/executions?${parameters}`);
  }

  /**
   * Reads one execution of tests the instance keeps.
   *
   * @param id - The identifier of the execution.
   * @returns The execution, with what came of each of its tests; the failure carries the code `unknown_execution` when the instance keeps none under it.
   */
  public execution(id: string): Promise<Execution> {
    return this.#ask<Execution>(`/executions/${encodeURIComponent(id)}`);
  }

  /**
   * Reads what came of the tests of a file in its latest executions.
   *
   * @param path - The path of the file, relative to the root of the test repository.
   * @returns Each execution that ran a test of it, the latest first, with what came of that test.
   */
  public async testExecutions(path: string): Promise<readonly TestExecution[]> {
    return (await this.#ask<TestExecutionList>(`/tests/executions?${new URLSearchParams({ path }).toString()}`)).items;
  }

  /**
   * Reads the versions of the tests of a file.
   *
   * @param path - The path of the file, relative to the root of the test repository.
   * @returns The versions of its tests, the latest first, then by their titles.
   */
  public async testVersions(path: string): Promise<readonly TestVersion[]> {
    return (await this.#ask<TestVersionList>(`/tests/versions?${new URLSearchParams({ path }).toString()}`)).items;
  }

  /**
   * Reads a test of the repository in steps, from the run of an execution.
   *
   * @param path - The path of the test, relative to the root of the test repository.
   * @param execution - The identifier of the execution.
   * @returns The test in steps; without a view when the report of the execution is gone or did not hold it.
   */
  public testReading(path: string, execution: string): Promise<TestReading> {
    return this.#ask<TestReading>(`/tests/reading?${new URLSearchParams({ path, execution }).toString()}`);
  }

  /**
   * Lists the documents of a knowledge source the instance keeps.
   *
   * @param source - The identifier of the source.
   * @returns Its documents, without their texts, in the order of their names; the failure carries the code
   * `unknown_document_source` when the configuration in force declares no such source.
   */
  public async documents(source: string): Promise<readonly StoredDocumentSummary[]> {
    return (await this.#ask<DocumentList>(documentsPath(source))).items;
  }

  /**
   * Reads a document of a knowledge source.
   *
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   * @returns The document, with its text; the failure carries the code `unknown_document` when the source holds none of that name.
   */
  public document(source: string, name: string): Promise<StoredDocument> {
    return this.#ask<StoredDocument>(`${documentsPath(source)}/${encodeURIComponent(name)}`);
  }

  /**
   * Uploads files as documents of a knowledge source, all of them or none.
   *
   * @param source - The identifier of the source.
   * @param files - The files, each named as its document.
   * @returns The documents of the source as they are now; the failure carries the code `invalid_documents` with its
   * errors, each at its file, when the instance refuses them.
   */
  public async upload(source: string, files: readonly File[]): Promise<readonly StoredDocumentSummary[]> {
    const body = new FormData();
    for (const file of files) body.append("documents", file, file.name);
    return (await this.#ask<DocumentList>(documentsPath(source), { method: "POST", body })).items;
  }

  /**
   * Removes a document of a knowledge source.
   *
   * @param source - The identifier of the source.
   * @param name - The file name of the document.
   * @returns Once it is removed; the failure carries the code `unknown_document` when the source no longer holds it.
   */
  public async removeDocument(source: string, name: string): Promise<void> {
    await this.#answer(`${documentsPath(source)}/${encodeURIComponent(name)}`, { method: "DELETE" });
  }

  /** @returns Every campaign of the instance, the latest planned first. */
  public async campaigns(): Promise<CampaignList> {
    return this.#ask<CampaignList>("/campaigns");
  }

  /**
   * Plans a campaign.
   *
   * @param plan - Its name and its environment; its tests are chosen next.
   * @returns The campaign, planned; the failure carries the code `invalid_request` for a plan that is not one.
   */
  public planCampaign(plan: CampaignPlan): Promise<Campaign> {
    return this.#ask<Campaign>("/campaigns", posting(plan));
  }

  /**
   * @param id - The identifier of a campaign.
   * @returns The campaign with what came of each of its tests; the failure carries the code `unknown_campaign` when the instance keeps none under it.
   */
  public campaign(id: string): Promise<CampaignProgress> {
    return this.#ask<CampaignProgress>(`/campaigns/${encodeURIComponent(id)}`);
  }

  /**
   * Chooses the tests of a planned campaign, in place of those chosen before.
   *
   * @returns The campaign; the failure carries the code `campaign_refused` when it is no longer planned, or a test is not one of the repository.
   */
  public chooseCampaignTests(id: string, tests: readonly CampaignTest[]): Promise<Campaign> {
    return this.#ask<Campaign>(`/campaigns/${encodeURIComponent(id)}/tests`, { ...posting({ tests }), method: "PUT" });
  }

  /** Fixes the tests of a planned campaign; the failure carries the code `campaign_refused` when its state does not allow it, or its scope takes no test. */
  public readyCampaign(id: string): Promise<Campaign> {
    return this.#ask<Campaign>(`/campaigns/${encodeURIComponent(id)}/readiness`, { method: "POST" });
  }

  /**
   * Launches the tests of a campaign: every one, those that failed, or those not run yet.
   *
   * @returns The launch; the failure carries the code `launch_refused` while a session or another launch runs.
   */
  public launchCampaign(id: string, only?: CampaignLaunchScope): Promise<TestLaunch> {
    return this.#ask<TestLaunch>(`/campaigns/${encodeURIComponent(id)}/launches`, posting(only === undefined ? {} : { only }));
  }

  /** Closes a campaign in progress, for good. */
  public closeCampaign(id: string): Promise<Campaign> {
    return this.#ask<Campaign>(`/campaigns/${encodeURIComponent(id)}/closure`, { method: "POST" });
  }

  /**
   * Launches tests of the repository as they are, with no agent.
   *
   * @returns The launch, which runs; the failure carries the code `launch_refused` while a session or another launch runs.
   */
  public launch(request: LaunchRequest): Promise<TestLaunch> {
    return this.#ask<TestLaunch>("/launches", posting(request));
  }

  /** @returns The launch of tests that runs in the instance, and the last one that ended. */
  public launches(): Promise<LaunchState> {
    return this.#ask<LaunchState>("/launches");
  }

  /** @returns The domains of the knowledge of the project, as the cartography named them; none before it. */
  public async domains(): Promise<readonly KnowledgeDomain[]> {
    return (await this.#ask<KnowledgeDomainList>("/knowledge/domains")).items;
  }

  /** The answer of the instance to a call, once it is a success. */
  async #answer(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await this.#fetch(`${API_BASE}${path}`, init);
    } catch {
      throw new ApiError(t("problems.unreachable"), 0, "unreachable");
    }
    if (!response.ok) throw await failureOf(response);
    return response;
  }

  async #ask<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.#answer(path, init);
    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError(t("problems.unreadable"), response.status, "error");
    }
  }
}
