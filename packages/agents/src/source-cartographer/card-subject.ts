import type { AgentEvent, ToolDefinition } from "@open-qa-stack/domain";
import { readsImages, type MappedKnowledge, type ResolvedConfig } from "@open-qa-stack/shared";
import {
  browserTools,
  knowledgeInventory,
  knowledgeTools,
  scopedToolName,
  type BrowserAccess,
  type KnowledgeAccess,
  type SourceInventory,
} from "@open-qa-stack/tools";
import { surveySource } from "../cartographer/source-survey.ts";
import { imageSecrets } from "../common/config-secrets.ts";
import { interfaceCardRequest, sourceCardRequest } from "./source-cartographer-prompt.ts";
import { interfaceFingerprint, visitedScreens } from "./visited-screens.ts";

/** Tools of a database that read rows: the cartographer of a source reads the catalog only. */
const DATA_TOOLS = ["sample_rows", "search", "query"];

/** The user interface of an application in one environment, named by the application. */
export interface InterfaceSource {
  readonly id: string;
  readonly type: "web";
  readonly environment: string;
}

/** A source a card is made of: a knowledge source, or the user interface of an application. */
export type CardSource = MappedKnowledge | InterfaceSource;

/** What the cartographer of a source works on: the tools of the source, and what the card must place. */
export interface CardSubject {
  /** Fingerprint of the source, known before any exploration. */
  readonly fingerprint: string;
  /** The tools of this source only. */
  readonly tools: readonly ToolDefinition[];
  /** The message that starts the cartography. */
  readonly request: string;
  /** The elements the card must place, as far as they are known now. */
  inventory(): SourceInventory;
  /** Releases what the tools hold; to call once the session is over. */
  close(): Promise<void>;
}

/**
 * The subject of the card of a knowledge source, whose inventory the harness reads before any exploration.
 *
 * @param source - The knowledge source.
 * @param access - How to reach it.
 * @param read - Its inventory, when it was read just before; read here otherwise.
 * @returns Its tools — the catalog of a base, never its rows — and its inventory.
 * @throws Error when the source does not answer.
 */
export async function knowledgeSubject(source: MappedKnowledge, access: KnowledgeAccess, read?: SourceInventory): Promise<CardSubject> {
  const inventory = read ?? (await knowledgeInventory(source, access));
  const tools = knowledgeTools([source], access).filter(
    (tool) => !(source.type === "postgresql" && DATA_TOOLS.some((action) => tool.name === scopedToolName(source.id, action))),
  );
  return {
    fingerprint: inventory.fingerprint,
    tools,
    request: sourceCardRequest(source.id, source.type, inventory),
    inventory: () => inventory,
    close: async () => undefined,
  };
}

/**
 * The subject of the card of a user interface, whose elements are the screens the agent visits.
 *
 * @param config - The resolved configuration.
 * @param source - The interface.
 * @param events - The events of the session, from which the screens visited are read.
 * @param access - The credentials, the folder of the screenshots and how the browser starts.
 * @returns The browser tools of the application, and the screens visited so far.
 * @throws Error when the application has no user interface in the environment, or it does not answer.
 */
export async function interfaceSubject(
  config: ResolvedConfig,
  source: InterfaceSource,
  events: readonly AgentEvent[],
  access: Pick<BrowserAccess, "env" | "screenshotsDir" | "launch" | "actionTimeoutMs" | "navigationTimeoutMs">,
): Promise<CardSubject> {
  const application = config.applications.find((candidate) => candidate.id === source.id);
  const uiUrl = application?.environments.find((environment) => environment.name === source.environment)?.uiUrl;
  if (application === undefined || uiUrl === undefined)
    throw new Error(`The application ${source.id} has no user interface in the environment ${source.environment}.`);
  const survey = await surveySource({ id: source.id, type: "web", uiUrl }, { repositoryRoot: "", env: access.env });
  if (!survey.ok) throw new Error(survey.error);
  const browser = browserTools([application], {
    ...access,
    environment: source.environment,
    vision: readsImages(config.model),
    secrets: imageSecrets(config, access.env),
  });
  return {
    fingerprint: interfaceFingerprint(uiUrl),
    tools: browser.tools,
    request: interfaceCardRequest(source.id, source.environment, uiUrl),
    inventory: () => visitedScreens(events, source.id, uiUrl),
    close: () => browser.close(),
  };
}
