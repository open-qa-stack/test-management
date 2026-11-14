import { join } from "node:path";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { declaredValues, readsImages, type Application, type Knowledge, type ResolvedConfig } from "@open-qa-stack/shared";
import { browserTools, knowledgeTools, scopedToolName, type BrowserAccess } from "@open-qa-stack/tools";
import { imageSecrets } from "../common/config-secrets.ts";
import { ScreenWatch } from "./screen-watch.ts";
import { SourceWatch } from "./source-watch.ts";

/** What a session of a design works on. */
export interface SessionScope {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** Absolute path of the test repository. */
  readonly repositoryRoot: string;
  /** Environment holding the connection strings and credentials the configuration names. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Name of the environment the session works on. */
  readonly environment: string;
  /** The applications the session has the browser tools of, when they have a user interface in the environment. */
  readonly applications: readonly Application[];
  /** The knowledge sources the session has the tools of. */
  readonly sources: readonly Knowledge[];
  /** When the task started: the tools of the logs read from there. */
  readonly start: Date;
  /** How the browser starts and waits; a headless Chromium with the default waits when `undefined`. */
  readonly browser: Pick<BrowserAccess, "launch" | "actionTimeoutMs" | "navigationTimeoutMs"> | undefined;
}

/** The tools of one session of a design, watched, and how to release the browser behind them. */
export interface SessionTools {
  /** What the session sees of the screens; it gives the browser tools. */
  readonly screens: ScreenWatch;
  /** What the session reads of the knowledge sources; it gives their tools. */
  readonly reads: SourceWatch;
  /** Closes the browser; to call once the session is over. */
  close(): Promise<void>;
}

/**
 * Builds the tools of one session of a design: the browser tools of its applications and the tools of its
 * knowledge sources, each behind a watch of its own, so that what a session saw and read is its alone.
 *
 * @remarks
 * The browser starts at the first call of a browser tool. The watch of the screens checks on the page, with
 * the browser of the session and without the model, the locators it builds itself. The search of each base says that the data of a
 * plan come from results such as its own.
 *
 * @param scope - What the session works on.
 * @returns The watches, which give the tools, and the means to close the browser.
 */
export function sessionTools(scope: SessionScope): SessionTools {
  const { config, repositoryRoot, env, applications, sources } = scope;
  const browser = browserTools(applications, {
    environment: scope.environment,
    env,
    screenshotsDir: join(repositoryRoot, config.repository.stateDir, "screenshots"),
    vision: readsImages(config.model),
    secrets: imageSecrets(config, env),
    ...scope.browser,
  });
  const screens = new ScreenWatch(
    applications.map((application) => application.id),
    browser.tools,
    (application, targets) => browser.matches(application, targets),
  );
  const secrets = declaredValues(config, env);
  const tools = knowledgeTools(sources, { repositoryRoot, env, secrets, taskStart: scope.start });
  return { screens, reads: new SourceWatch(sources, withDataHint(tools, sources), secrets), close: () => browser.close() };
}

/** The tools of the sources, the search of each base saying that the data of a plan come from results such as its own. */
function withDataHint(tools: readonly ToolDefinition[], sources: readonly Knowledge[]): ToolDefinition[] {
  const searches = new Set(sources.filter((source) => source.type === "postgresql").map((source) => scopedToolName(source.id, "search")));
  return tools.map((tool) =>
    searches.has(tool.name) ? { ...tool, description: `${tool.description} A value of the data of a plan comes from a result such as this one.` } : tool,
  );
}
