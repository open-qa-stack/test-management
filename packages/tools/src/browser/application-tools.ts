import { join } from "node:path";
import { destructiveName } from "./destructive-target.ts";
import type { Locator } from "playwright-core";
import { ImageToolResult, type ToolDefinition } from "@open-qa-stack/domain";
import type { Account, Application, Environment } from "@open-qa-stack/shared";
import { scopedToolName } from "../common/tool-name.ts";
import { LOG_CAPACITY, type ApplicationPage, type PageScope, type PageState, type TargetMatch, type Until } from "./application-page.ts";
import type { BrowserSession } from "./browser-session.ts";
import { secretForms } from "./redact.ts";
import { TARGET_SCHEMA, targetCode, type Target } from "./target.ts";

/** Longest wait an agent may ask for, in milliseconds. */
export const MAX_WAIT_MS = 15_000;
/** Wait when the agent does not say, in milliseconds. */
export const DEFAULT_WAIT_MS = 5000;
/** Entries a log tool returns when the agent does not say. */
const DEFAULT_LOG_ENTRIES = 20;
/** Why the model is not shown the screenshot of a page that shows a secret. */
const SECRET_SHOWN = "The page shows a secret of the configuration: its image is not shown.";

/** The credential of a declared test account, which the model never sees. */
type Credential = { readonly account: string; readonly field: "username" | "password" };
/** A value to type, or the credential of a declared test account. */
type FillValue = string | Credential;

/** Where the page is after a tool, and the line of code that does the same in a test. */
type Done = PageState & { readonly code: string };

/** What the browser tools of an application need. */
export interface ApplicationToolAccess {
  /** The browser of the session. */
  readonly session: BrowserSession;
  /** Environment holding the credentials of the test accounts. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Folder the screenshots are written to. */
  readonly screenshotsDir: string;
  /** Whether the model reads images: the screenshot tool then gives it the image too. */
  readonly vision: boolean;
  /** The secrets no image the model is shown may show: those the session gives. */
  readonly imageSecrets: readonly string[];
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
 * afterwards, and the line of code a test writes to do the same: a path relative to the user interface for
 * an address of it, and the environment variable of a credential rather than its value. The agent may type a test account's credentials by
 * naming the account; nothing of them is masked: a test environment shows them.
 *
 * @param application - The application.
 * @param environment - Its environment, which has a user interface.
 * @param access - The browser, the credentials and where screenshots go.
 * @returns The tools, named after the application.
 */
export function applicationTools(application: Application, environment: Environment & { uiUrl: string }, access: ApplicationToolAccess): ToolDefinition[] {
  const scope = pageScope(application.id, environment);
  // A page may show a secret in another case than its own, by a style; an image is refused whatever the case.
  const unseen = access.imageSecrets.flatMap(secretForms).map((form) => form.toLowerCase());
  const showsSecret = (text: string) => unseen.some((form) => text.toLowerCase().includes(form));
  const name = (action: string) => scopedToolName(application.id, action);
  // The model may call several tools at once; on one page, they run one after the other, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const on =
    <T>(use: (page: ApplicationPage, args: T) => Promise<unknown>) =>
    (args: unknown) => {
      const run = queue.then(async () => {
        return use(await access.session.page(scope), args as T);
      });
      queue = run.catch(() => undefined);
      return run;
    };
  const where = `of ${application.name} (${environment.name})`;
  let screenshots = 0;
  const screenshotPath = () => join(access.screenshotsDir, `${application.id}-${++screenshots}.png`);
  return [
    {
      name: name("goto"),
      description: `Opens an address ${where}, absolute or relative to ${environment.uiUrl}. Other sites are refused. Returns where the page is, and the line of code that does the same in a test.`,
      parameters: { type: "object", properties: { url: { type: "string", minLength: 1 } }, required: ["url"], additionalProperties: false },
      browserAction: true,
      execute: on(async (page, { url }: { url: string }): Promise<Done> => {
        await page.goto(url);
        return { ...(await page.state()), code: `await page.goto(${JSON.stringify(testAddress(url, environment.uiUrl))});` };
      }),
    },
    {
      name: name("snapshot"),
      description: `Returns what the page ${where} shows. Each element you can act on ends with the locator a test uses for it. within limits it to one part, such as a table or a dialog.`,
      parameters: { type: "object", properties: { within: TARGET_SCHEMA }, additionalProperties: false },
      execute: on((page, { within }: { within?: Target }) => page.snapshot(within)),
    },
    {
      name: name("click"),
      description: `Clicks an element of the page ${where}. An element whose name says it removes data, such as Delete, is clicked only with confirm. Returns where the page is, and the line of code that does the same in a test.`,
      parameters: {
        type: "object",
        properties: {
          target: TARGET_SCHEMA,
          confirm: { type: "boolean", description: "true to click an element that may remove data, once a result of this tool asked for it." },
        },
        required: ["target"],
        additionalProperties: false,
      },
      browserAction: true,
      execute: on(async (page, { target, confirm }: { target: Target; confirm?: boolean }): Promise<Done | { error: string }> => {
        const removing = destructiveName(target);
        // What an exploration removes is gone for every test and every user of the environment: the agent says it means it.
        if (removing !== undefined && confirm !== true)
          return {
            error: `Nothing was clicked: "${removing}" may remove data of the application, which every test and every user of the environment share. If the brief asks for this removal, call again with "confirm": true. If you only need to know what it does, read the source, or plan a test that stops before the removal, such as one that cancels its confirmation.`,
          };
        return acted(page, target, "click()", (element) => element.click());
      }),
    },
    {
      name: name("fill"),
      description: `Fills a field of the page ${where}. To type a test account's credential, give { "account": <name>, "field": "username" | "password" } as the value. Accounts: ${accountNames(application)}. Returns where the page is, and the line of code that does the same in a test.`,
      parameters: {
        type: "object",
        properties: {
          target: TARGET_SCHEMA,
          value: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                properties: { account: { type: "string" }, field: { enum: ["username", "password"] } },
                required: ["account", "field"],
                additionalProperties: false,
              },
            ],
          },
        },
        required: ["target", "value"],
        additionalProperties: false,
      },
      browserAction: true,
      execute: on((page, { target, value }: { target: Target; value: FillValue }) => {
        if (typeof value === "string") return acted(page, target, `fill(${JSON.stringify(value)})`, (element) => element.fill(value));
        const variable = credentialVariable(application, value);
        const text = access.env[variable];
        if (text === undefined || text === "") throw new Error(`Environment variable ${variable} is not set.`);
        return acted(page, target, `fill(process.env.${variable}!)`, (element) => element.fill(text));
      }),
    },
    {
      name: name("select_option"),
      description: `Chooses an option, by its label or value, in a list of the page ${where}. Returns where the page is, and the line of code that does the same in a test.`,
      parameters: {
        type: "object",
        properties: { target: TARGET_SCHEMA, option: { type: "string" } },
        required: ["target", "option"],
        additionalProperties: false,
      },
      browserAction: true,
      execute: on((page, { target, option }: { target: Target; option: string }) =>
        acted(page, target, `selectOption(${JSON.stringify(option)})`, (element) => element.selectOption(option)),
      ),
    },
    {
      name: name("check"),
      description: `Checks or unchecks a checkbox or radio button of the page ${where}. Returns where the page is, and the line of code that does the same in a test.`,
      parameters: {
        type: "object",
        properties: { target: TARGET_SCHEMA, checked: { type: "boolean" } },
        required: ["target", "checked"],
        additionalProperties: false,
      },
      browserAction: true,
      execute: on((page, { target, checked }: { target: Target; checked: boolean }) =>
        acted(page, target, checked ? "check()" : "uncheck()", (element) => element.setChecked(checked)),
      ),
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
    access.vision
      ? {
          name: name("screenshot"),
          description: `Saves a screenshot of the page ${where}, or of one of its elements, and returns where it is, with the image for you to look at, its type and its size in pixels. The image is never reduced, and one larger than the model is shown whole is not given: to look closer at a part of the page, or at a long page, capture its element. Password fields are covered. Use the image to find what a snapshot renders poorly, such as a button without a name or an icon alone, and base no assertion on the image alone. A task is shown a few images at most; past them, or when the page shows a secret of the configuration, you get the path alone and the reason.`,
          parameters: {
            type: "object",
            properties: {
              fullPage: { type: "boolean", description: "The whole page rather than the viewport." },
              within: { ...TARGET_SCHEMA, description: "The one element to capture, such as a toolbar or a dialog." },
            },
            not: { required: ["fullPage", "within"] },
            additionalProperties: false,
          },
          execute: on(async (page, { fullPage, within }: { fullPage?: boolean; within?: Target }) => {
            const path = screenshotPath();
            // Read before and after, so that a page that changes during the capture is held to both of its states.
            const before = await page.shownText();
            const png = await page.capture(path, within === undefined ? { fullPage: fullPage ?? false } : { within });
            if ([before, await page.shownText()].some(showsSecret)) return ImageToolResult.withheld({ path }, SECRET_SHOWN);
            return new ImageToolResult({ path }, png);
          }),
        }
      : {
          name: name("screenshot"),
          description: `Saves a screenshot of the page ${where} and returns where it is.`,
          parameters: {
            type: "object",
            properties: { fullPage: { type: "boolean", description: "The whole page rather than the viewport." } },
            additionalProperties: false,
          },
          execute: on(async (page, { fullPage }: { fullPage?: boolean }) => {
            const path = screenshotPath();
            await page.screenshot(path, fullPage ?? false);
            return { path };
          }),
        },
    {
      name: name("network"),
      description: `Returns the latest requests of the page ${where}, with their status: the document and its API calls, and the assets when asked.`,
      parameters: {
        type: "object",
        properties: { limit: limit(`Defaults to ${DEFAULT_LOG_ENTRIES}.`), assets: { type: "boolean" } },
        additionalProperties: false,
      },
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

/**
 * Counts, on the page of an application as it is now, the elements each of several targets designates: what
 * a harness checks a locator against, without the model.
 *
 * @param application - The application.
 * @param environment - Its environment, which has a user interface.
 * @param session - The browser of the session.
 * @param targets - The elements.
 * @returns What each designates, in their order.
 * @throws Error when the page cannot be opened or read.
 */
export async function applicationMatches(
  application: Application,
  environment: Environment & { uiUrl: string },
  session: BrowserSession,
  targets: readonly Target[],
): Promise<TargetMatch[]> {
  const page = await session.page(pageScope(application.id, environment));
  const matches: TargetMatch[] = [];
  for (const target of targets) matches.push(await page.matches(target));
  return matches;
}

/** Acts on an element, then says where the page is, and how a test does the same: the call of `method` on the locator of the target. */
async function acted(page: ApplicationPage, target: Target, method: string, action: (element: Locator) => Promise<unknown>): Promise<Done> {
  await page.act(target, action);
  return { ...(await page.state()), code: `await ${targetCode(target)}.${method};` };
}

/** The address a test opens for one given to a tool: its path when it is on the user interface, which the base URL of the test then completes. */
function testAddress(url: string, uiUrl: string): string {
  // The page opened it: it parses.
  const address = new URL(url, uiUrl);
  return address.origin === new URL(uiUrl).origin ? `${address.pathname}${address.search}${address.hash}` : address.href;
}

function pageScope(applicationId: string, environment: Environment & { uiUrl: string }): PageScope {
  const urls = [environment.uiUrl, ...(environment.apis ?? []).map((api) => api.baseUrl)];
  return { applicationId, uiUrl: environment.uiUrl, origins: new Set(urls.map((url) => new URL(url).origin)) };
}

function accountNames(application: Application): string {
  const accounts = application.authentication.accounts ?? [];
  return accounts.length === 0 ? "none" : accounts.map((account) => account.name).join(", ");
}

/** The environment variable that holds a credential of a declared test account. */
function credentialVariable(application: Application, { account, field }: Credential): string {
  const declared: Account | undefined = application.authentication.accounts?.find((a) => a.name === account);
  if (declared === undefined) throw new Error(`${application.id} has no test account named ${account}; accounts: ${accountNames(application)}.`);
  return field === "username" ? declared.usernameEnv : declared.passwordEnv;
}
