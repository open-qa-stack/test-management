import type { ToolDefinition } from "@open-qa-stack/domain";
import { readsImages, type MappedKnowledge, type ResolvedConfig } from "@open-qa-stack/shared";
import {
  browserTools,
  fingerprintOf,
  knowledgeInventory,
  knowledgeTools,
  type BrowserAccess,
  type KnowledgeAccess,
  type SourceInventory,
} from "@open-qa-stack/tools";
import { surveySource } from "../cartographer/source-survey.ts";
import { configSecrets } from "../common/config-secrets.ts";

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
  /** The elements the harness read of the source before any exploration; none for a user interface, which an agent explores. */
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
 * @returns Its tools and its inventory.
 * @throws Error when the source does not answer.
 */
export async function knowledgeSubject(source: MappedKnowledge, access: KnowledgeAccess, read?: SourceInventory): Promise<CardSubject> {
  const inventory = read ?? (await knowledgeInventory(source, access));
  return {
    fingerprint: inventory.fingerprint,
    tools: knowledgeTools([source], access),
    inventory: () => inventory,
    close: async () => undefined,
  };
}

/**
 * The subject of the card of a user interface: its browser tools, and nothing read beforehand, since what an
 * interface shows cannot be read without exploring it. Its fingerprint is that of its address, so that its
 * card is made again on demand only.
 *
 * @param config - The resolved configuration.
 * @param source - The interface.
 * @param access - The credentials, the folder of the screenshots and how the browser starts.
 * @returns The browser tools of the application, and the screens visited so far.
 * @throws Error when the application has no user interface in the environment, or it does not answer.
 */
export async function interfaceSubject(
  config: ResolvedConfig,
  source: InterfaceSource,
  access: Pick<BrowserAccess, "env" | "screenshotsDir" | "launch" | "actionTimeoutMs" | "navigationTimeoutMs" | "settleTimeoutMs">,
): Promise<CardSubject> {
  const application = config.applications.find((candidate) => candidate.id === source.id);
  const uiUrl = application?.environments.find((environment) => environment.name === source.environment)?.uiUrl;
  if (application === undefined || uiUrl === undefined)
    throw new Error(`The application ${source.id} has no user interface in the environment ${source.environment}.`);
  const survey = await surveySource({ id: source.id, type: "web", uiUrl }, { repositoryRoot: "", env: access.env });
  if (!survey.ok) throw new Error(survey.error);
  const fingerprint = fingerprintOf(uiUrl);
  const browser = browserTools([application], {
    ...access,
    environment: source.environment,
    vision: readsImages(config.model),
    secrets: configSecrets(config, access.env),
  });
  return {
    fingerprint,
    tools: browser.tools,
    inventory: () => ({ items: [], facts: new Map(), fingerprint }),
    close: () => browser.close(),
  };
}
