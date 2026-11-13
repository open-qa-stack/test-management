import { chromium, type Browser } from "playwright-core";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Application, Environment } from "@open-qa-stack/shared";
import { applicationTools } from "./application-tools.ts";
import { BrowserSession } from "./browser-session.ts";

/** Default wait for an element to be ready for an action, in milliseconds. */
export const ACTION_TIMEOUT_MS = 5000;
/** Default wait for a navigation to load, in milliseconds. */
export const NAVIGATION_TIMEOUT_MS = 15_000;
/** Longest wait for the requests of a page to end once it is opened or acted on, in milliseconds. */
export const SETTLE_TIMEOUT_MS = 3000;

/** What the browser tools of a session need. */
export interface BrowserAccess {
  /** Name of the environment the session works on. */
  readonly environment: string;
  /** Environment holding the credentials of the test accounts. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Folder the screenshots are written to. */
  readonly screenshotsDir: string;
  /** Wait for an element to be ready for an action; `ACTION_TIMEOUT_MS` by default. */
  readonly actionTimeoutMs?: number;
  /** Wait for a navigation to load; `NAVIGATION_TIMEOUT_MS` by default. */
  readonly navigationTimeoutMs?: number;
  /** Wait for the requests of a page to end once it is opened or acted on; `SETTLE_TIMEOUT_MS` by default. */
  readonly settleTimeoutMs?: number;
  /** Starts the browser; a headless Chromium by default. */
  readonly launch?: () => Promise<Browser>;
}

/** The browser tools of a session, and how to release the browser behind them. */
export interface BrowserToolset {
  /** The tools of every application that has a user interface in the environment. */
  readonly tools: readonly ToolDefinition[];
  /** Closes the browser; to call once the session is over. */
  close(): Promise<void>;
}

/**
 * Gives a session the browser tools of each application that has a user interface in its environment.
 *
 * @remarks
 * Each application gets its own browser context, opened on its user interface at the first call of one
 * of its tools. The browser starts at that first call too, and is shared by the applications.
 *
 * @param applications - The applications of the configuration.
 * @param access - The environment, the credentials and the browser.
 * @returns The tools, application after application, and the means to close the browser.
 */
export function browserTools(applications: readonly Application[], access: BrowserAccess): BrowserToolset {
  const session = new BrowserSession(access.launch ?? (() => chromium.launch()), {
    actionMs: access.actionTimeoutMs ?? ACTION_TIMEOUT_MS,
    navigationMs: access.navigationTimeoutMs ?? NAVIGATION_TIMEOUT_MS,
    settleMs: access.settleTimeoutMs ?? SETTLE_TIMEOUT_MS,
  });
  const tools = applications.flatMap((application) => {
    const environment = application.environments.find((e) => e.name === access.environment);
    return hasUserInterface(environment) ? applicationTools(application, environment, { session, env: access.env, screenshotsDir: access.screenshotsDir }) : [];
  });
  return { tools, close: () => session.close() };
}

function hasUserInterface(environment: Environment | undefined): environment is Environment & { uiUrl: string } {
  return environment?.uiUrl !== undefined;
}
