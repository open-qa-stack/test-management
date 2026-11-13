import { join } from "node:path";
import type { Locator } from "playwright-core";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Account, Application, Environment } from "@open-qa-stack/shared";
import { scopedToolName } from "../common/tool-name.ts";
import { LOG_CAPACITY, type ApplicationPage, type PageScope, type PageState, type Until } from "./application-page.ts";
import type { BrowserSession } from "./browser-session.ts";
import { redact, redactText, secretForms } from "./redact.ts";
import { TARGET_SCHEMA, type Target } from "./target.ts";

/** Longest wait an agent may ask for, in milliseconds. */
export const MAX_WAIT_MS = 15_000;
/** Wait when the agent does not say, in milliseconds. */
export const DEFAULT_WAIT_MS = 5000;
/** Entries a log tool returns when the agent does not say. */
const DEFAULT_LOG_ENTRIES = 20;

/** A value to type, or the credential of a declared test account, which the model never sees. */
type FillValue = string | { readonly account: string; readonly field: "username" | "password" };

/** What the browser tools of an application need. */
export interface ApplicationToolAccess {
  /** The browser of the session. */
  readonly session: BrowserSession;
  /** Environment holding the credentials of the test accounts. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Folder the screenshots are written to. */
  readonly screenshotsDir: string;
}

const limit = (description: string) => ({ type: "integer", minimum: 1, maximum: LOG_CAPACITY, description }) as const;

/**
 * The browser tools of one application in one environment: navigate, read the page, act on it, and read
 * its requests and console.
 *
 * @remarks
 * Tools that change the page count as browser actions; snapshots, waits, screenshots and logs do not.
 * Calls on the page of the application run one after the other, in the order they came, so that
 * calls the model makes at once do not interrupt each other. Tools that act return where the page is
 * afterwards. The agent types a test account's credentials by
 * naming the account, never by their value; the passwords are masked in everything the tools return,
 * errors included, in the forms a page may show them.
 *
 * @param application - The application.
 * @param environment - Its environment, which has a user interface.
 * @param access - The browser, the credentials and where screenshots go.
 * @returns The tools, named after the application.
 */
export function applicationTools(application: Application, environment: Environment & { uiUrl: string }, access: ApplicationToolAccess): ToolDefinition[] {
  const scope = pageScope(application.id, environment);
  const secrets = (application.authentication.accounts ?? []).flatMap((account) => nonEmpty(access.env[account.passwordEnv]).flatMap(secretForms));
  const name = (action: string) => scopedToolName(application.id, action);
  // The model may call several tools at once; on one page, they run one after the other, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const on = <T>(use: (page: ApplicationPage, args: T) => Promise<unknown>) => (args: unknown) => {
    const run = queue.then(async () => {
      try {
        return redact(await use(await access.session.page(scope), args as T), secrets);
      } catch (failure) {
        throw new Error(redactText(failure instanceof Error ? failure.message : String(failure), secrets));
      }
    });
    queue = run.catch(() => undefined);
    return run;
  };
  const where = `of ${application.name} (${environment.name})`;
  let screenshots = 0;
  return [
    {
      name: name("goto"),
      description: `Opens an address ${where}, absolute or relative to ${environment.uiUrl}. Other sites are refused.`,
      parameters: { type: "object", properties: { url: { type: "string", minLength: 1 } }, required: ["url"], additionalProperties: false },
      browserAction: true,
      execute: on(async (page, { url }: { url: string }) => {
        await page.goto(url);
        return page.state();
      }),
    },
    {
      name: name("snapshot"),
      description: `Returns the accessibility tree of the page ${where}. Each element you can act on ends with the Playwright locator a test should use for it.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: on((page) => page.snapshot()),
    },
    {
      name: name("click"),
      description: `Clicks an element of the page ${where}.`,
      parameters: { type: "object", properties: { target: TARGET_SCHEMA }, required: ["target"], additionalProperties: false },
      browserAction: true,
      execute: on((page, { target }: { target: Target }) => acted(page, target, (element) => element.click())),
    },
    {
      name: name("fill"),
      description: `Fills a field of the page ${where}. To type a test account's credential, give { "account": <name>, "field": "username" | "password" } as the value: you are never given the password. Accounts: ${accountNames(application)}.`,
      parameters: {
        type: "object",
        properties: {
          target: TARGET_SCHEMA,
          value: {
            oneOf: [
              { type: "string" },
              { type: "object", properties: { account: { type: "string" }, field: { enum: ["username", "password"] } }, required: ["account", "field"], additionalProperties: false },
            ],
          },
        },
        required: ["target", "value"],
        additionalProperties: false,
      },
      browserAction: true,
      execute: on((page, { target, value }: { target: Target; value: FillValue }) => {
        const text = typeof value === "string" ? value : credential(application, access.env, value);
        return acted(page, target, (element) => element.fill(text));
      }),
    },
    {
      name: name("select_option"),
      description: `Chooses an option, by its label or value, in a list of the page ${where}.`,
      parameters: { type: "object", properties: { target: TARGET_SCHEMA, option: { type: "string" } }, required: ["target", "option"], additionalProperties: false },
      browserAction: true,
      execute: on((page, { target, option }: { target: Target; option: string }) => acted(page, target, (element) => element.selectOption(option))),
    },
    {
      name: name("check"),
      description: `Checks or unchecks a checkbox or radio button of the page ${where}.`,
      parameters: { type: "object", properties: { target: TARGET_SCHEMA, checked: { type: "boolean" } }, required: ["target", "checked"], additionalProperties: false },
      browserAction: true,
      execute: on((page, { target, checked }: { target: Target; checked: boolean }) => acted(page, target, (element) => element.setChecked(checked))),
    },
    {
      name: name("wait_for"),
      description: `Waits until an element of the page ${where} is visible or hidden, or until its address contains a text.`,
      parameters: {
        type: "object",
        properties: {
          target: TARGET_SCHEMA,
          state: { enum: ["visible", "hidden"], description: "Defaults to visible." },
          urlIncludes: { type: "string", minLength: 1 },
          timeoutMs: { type: "integer", minimum: 1, maximum: MAX_WAIT_MS, description: `Defaults to ${DEFAULT_WAIT_MS}, ${MAX_WAIT_MS} at most.` },
        },
        oneOf: [
          { required: ["target"], not: { required: ["urlIncludes"] } },
          { required: ["urlIncludes"], not: { anyOf: [{ required: ["target"] }, { required: ["state"] }] } },
        ],
        additionalProperties: false,
      },
      execute: on(async (page, args: { target?: Target; state?: "visible" | "hidden"; urlIncludes?: string; timeoutMs?: number }) => {
        const until: Until = args.target === undefined ? { urlIncludes: args.urlIncludes! } : { target: args.target, state: args.state ?? "visible" };
        await page.waitFor(until, args.timeoutMs ?? DEFAULT_WAIT_MS);
        return page.state();
      }),
    },
    {
      name: name("screenshot"),
      description: `Saves a screenshot of the page ${where} and returns where it is.`,
      parameters: { type: "object", properties: { fullPage: { type: "boolean", description: "The whole page rather than the viewport." } }, additionalProperties: false },
      execute: on(async (page, { fullPage }: { fullPage?: boolean }) => {
        const path = join(access.screenshotsDir, `${application.id}-${++screenshots}.png`);
        await page.screenshot(path, fullPage ?? false);
        return { path };
      }),
    },
    {
      name: name("network"),
      description: `Returns the latest requests of the page ${where}, with their status: the document and its API calls, and the assets when asked.`,
      parameters: { type: "object", properties: { limit: limit(`Defaults to ${DEFAULT_LOG_ENTRIES}.`), assets: { type: "boolean" } }, additionalProperties: false },
      execute: on(async (page, { limit: count, assets }: { limit?: number; assets?: boolean }) => page.network(count ?? DEFAULT_LOG_ENTRIES, assets ?? false)),
    },
    {
      name: name("console"),
      description: `Returns the latest console messages and uncaught errors of the page ${where}.`,
      parameters: { type: "object", properties: { limit: limit(`Defaults to ${DEFAULT_LOG_ENTRIES}.`) }, additionalProperties: false },
      execute: on(async (page, { limit: count }: { limit?: number }) => page.console(count ?? DEFAULT_LOG_ENTRIES)),
    },
  ];
}

/** Acts on an element, then says where the page is. */
async function acted(page: ApplicationPage, target: Target, action: (element: Locator) => Promise<unknown>): Promise<PageState> {
  await page.act(target, action);
  return page.state();
}

function pageScope(applicationId: string, environment: Environment & { uiUrl: string }): PageScope {
  const urls = [environment.uiUrl, ...(environment.apis ?? []).map((api) => api.baseUrl)];
  return { applicationId, uiUrl: environment.uiUrl, origins: new Set(urls.map((url) => new URL(url).origin)) };
}

function accountNames(application: Application): string {
  const accounts = application.authentication.accounts ?? [];
  return accounts.length === 0 ? "none" : accounts.map((account) => account.name).join(", ");
}

function credential(application: Application, env: ApplicationToolAccess["env"], { account, field }: { account: string; field: "username" | "password" }): string {
  const declared: Account | undefined = application.authentication.accounts?.find((a) => a.name === account);
  if (declared === undefined) throw new Error(`${application.id} has no test account named ${account}; accounts: ${accountNames(application)}.`);
  const variable = field === "username" ? declared.usernameEnv : declared.passwordEnv;
  const value = env[variable];
  if (value === undefined || value === "") throw new Error(`Environment variable ${variable} is not set.`);
  return value;
}

function nonEmpty(value: string | undefined): string[] {
  return value === undefined || value === "" ? [] : [value];
}
