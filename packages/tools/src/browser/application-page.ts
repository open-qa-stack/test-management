import { setTimeout as wait } from "node:timers/promises";
import { errors, type Browser, type Locator, type Page, type Route } from "playwright-core";
import { PageLog, type ConsoleEntry, type NetworkEntry } from "./page-log.ts";
import { pageSnapshot, type PageSnapshot } from "./page-snapshot.ts";
import { shortText } from "./short-text.ts";
import { locate, targetCode, type Target } from "./target.ts";

/** Entries of each kind a page log keeps. */
export const LOG_CAPACITY = 50;
/** Most redirects a navigation may follow. */
export const MAX_REDIRECTS = 10;
/** How long a page must send no request to be held as settled, in milliseconds. */
export const QUIET_MS = 300;
/** How often the requests of a page are looked at while it settles, in milliseconds. */
const POLL_MS = 50;

/** Where an application's page may go. */
export interface PageScope {
  /** Identifier of the application, for messages. */
  readonly applicationId: string;
  /** Address of its user interface, where the page opens and against which relative addresses resolve. */
  readonly uiUrl: string;
  /** Origins the page may navigate to: its user interface and its APIs. */
  readonly origins: ReadonlySet<string>;
}

/** How long the page waits, in milliseconds. */
export interface PageTimeouts {
  /** For an element to be ready for an action. */
  readonly actionMs: number;
  /** For a navigation to load. */
  readonly navigationMs: number;
  /** For the requests of the page to end, after it is opened or acted on. */
  readonly settleMs: number;
}

/** Where the page is. */
export interface PageState {
  /** Address of the page, cut when very long. */
  readonly url: string;
  /** Title of the page, cut when very long. */
  readonly title: string;
}

/** What to wait for: an element in a state, or an address that contains a text. */
export type Until = { readonly target: Target; readonly state: "visible" | "hidden" } | { readonly urlIncludes: string };

/**
 * The page of one application in a browser context of its own, kept on the application's addresses.
 *
 * @remarks
 * Once it is opened or acted on, the page is given time to load what it asks its services, so that it is
 * read with its data. A navigation of the page, whatever starts it, is refused unless it goes to one of the origins of the
 * application. Its redirects are followed hop by hop by the harness before the browser receives an answer,
 * so that no redirect reaches another origin either; the browser is then sent to the last address, which is
 * thus requested twice. A form sent with `POST` is sent once, the hops after a `303` going by `GET`. A refused navigation is cancelled the way a
 * browser cancels one, the page stays where it was, and the refusal shows in the network log. Requests that
 * are not navigations are not filtered. An action that fails says why, followed by a fresh snapshot of the
 * page, so that the agent can choose its next step without another call.
 */
export class ApplicationPage {
  private readonly scope: PageScope;
  private readonly timeouts: PageTimeouts;
  private readonly page: Page;
  private readonly log: PageLog;
  /** The requests the page sent that have not ended. */
  private pending = 0;

  private constructor(scope: PageScope, timeouts: PageTimeouts, page: Page, log: PageLog) {
    this.scope = scope;
    this.timeouts = timeouts;
    this.page = page;
    this.log = log;
  }

  /**
   * Opens a new browser context on the application's user interface.
   *
   * @param browser - The browser of the session.
   * @param scope - The application's addresses.
   * @param timeouts - How long the page waits.
   * @returns The page, loaded.
   * @throws Error when the user interface cannot be loaded.
   */
  public static async open(browser: Browser, scope: PageScope, timeouts: PageTimeouts): Promise<ApplicationPage> {
    // The page is served through the guard, which hides where it comes from: without this grant, the browser refuses the calls a local interface makes to its own local services.
    const context = await browser.newContext({ permissions: ["local-network-access"] });
    context.setDefaultTimeout(timeouts.actionMs);
    context.setDefaultNavigationTimeout(timeouts.navigationMs);
    const page = await context.newPage();
    const log = new PageLog(LOG_CAPACITY);
    log.listen(page);
    const opened = new ApplicationPage(scope, timeouts, page, log);
    page.on("request", () => opened.pending++);
    page.on("requestfinished", () => opened.pending--);
    page.on("requestfailed", () => opened.pending--);
    await context.route("**/*", (route) => opened.guard(route));
    try {
      await page.goto(scope.uiUrl);
      await opened.settled();
    } catch (failure) {
      await context.close();
      throw new Error(`The user interface of ${scope.applicationId} at ${scope.uiUrl} cannot be loaded: ${firstLine(failure)}`);
    }
    return opened;
  }

  /**
   * Where the page is now.
   *
   * @returns Its address and title.
   */
  public async state(): Promise<PageState> {
    return { url: shortText(this.page.url()), title: shortText(await this.page.title()) };
  }

  /**
   * Opens an address of the application.
   *
   * @param url - The address, absolute or relative to the user interface.
   * @throws Error when the address is not one of the application's, or does not load.
   */
  public async goto(url: string): Promise<void> {
    const address = URL.parse(url, this.scope.uiUrl);
    if (address === null || !this.allows(address)) {
      throw new Error(`${shortText(url)} is not an address of ${this.scope.applicationId}; allowed origins: ${[...this.scope.origins].join(", ")}.`);
    }
    try {
      await this.page.goto(address.href);
    } catch (failure) {
      throw new Error(`${shortText(address.href)} did not load: ${firstLine(failure)}`);
    }
    await this.settled();
  }

  /**
   * Reads what the page shows, or one part of it.
   *
   * @param within - The one element whose subtree to read, such as a table or a dialog; the whole page otherwise.
   * @returns Its snapshot.
   * @throws Error when the page cannot be read, for instance while it navigates; or, with `within`, when no
   * element, or more than one, matches it in time.
   */
  public async snapshot(within?: Target): Promise<PageSnapshot> {
    if (within === undefined) return pageSnapshot(this.page);
    const part = locate(this.page, within);
    try {
      // A snapshot does not wait for its element: the wait tells a missing element from several.
      await part.waitFor({ state: "attached" });
      return await pageSnapshot(this.page, part);
    } catch (failure) {
      throw await this.failed(failure, `${targetCode(within)} did not appear within ${this.timeouts.actionMs} ms.`, within);
    }
  }

  /**
   * Acts on one element, once Playwright finds it ready.
   *
   * @param target - The element.
   * @param action - What to do with its locator.
   * @throws Error saying why the action failed, with a snapshot of the page.
   */
  public async act(target: Target, action: (locator: Locator) => Promise<unknown>): Promise<void> {
    try {
      await action(locate(this.page, target));
    } catch (failure) {
      throw await this.failed(failure, `${targetCode(target)} did not become ready within ${this.timeouts.actionMs} ms.`, target);
    }
    await this.settled();
  }

  /**
   * Waits until the page has sent no request for `QUIET_MS`, so that what it loads from its services is
   * on the screen when it is read; gives up once the settling time is over, as for a page that keeps a
   * request open.
   */
  private async settled(): Promise<void> {
    const deadline = Date.now() + this.timeouts.settleMs;
    let quietSince = Date.now();
    while (Date.now() < deadline) {
      if (this.pending > 0) quietSince = Date.now();
      else if (Date.now() - quietSince >= QUIET_MS) return;
      await wait(POLL_MS);
    }
  }

  /**
   * Waits for an element to reach a state, or for the address to contain a text.
   *
   * @param until - What to wait for.
   * @param timeoutMs - How long to wait.
   * @throws Error when it did not happen in time, with a snapshot of the page.
   */
  public async waitFor(until: Until, timeoutMs: number): Promise<void> {
    try {
      if ("urlIncludes" in until) {
        await this.page.waitForURL((url) => url.href.includes(until.urlIncludes), { timeout: timeoutMs });
      } else {
        await locate(this.page, until.target).waitFor({ state: until.state, timeout: timeoutMs });
      }
    } catch (failure) {
      if ("urlIncludes" in until) {
        throw await this.failed(failure, `The address did not come to include ${JSON.stringify(until.urlIncludes)} within ${timeoutMs} ms.`);
      }
      throw await this.failed(failure, `${targetCode(until.target)} did not become ${until.state} within ${timeoutMs} ms.`, until.target);
    }
  }

  /**
   * Writes an image of the page.
   *
   * @param path - File to write the PNG image to.
   * @param fullPage - Whether to capture the whole page rather than the viewport.
   * @throws Error when the page cannot be captured or the file written.
   */
  public async screenshot(path: string, fullPage: boolean): Promise<void> {
    await this.page.screenshot({ path, fullPage });
  }

  /**
   * Lists the latest requests of the page.
   *
   * @param limit - Most entries to return.
   * @param assets - Whether to include scripts, styles, images and fonts.
   * @returns The requests, oldest first.
   */
  public network(limit: number, assets: boolean): NetworkEntry[] {
    return this.log.network(limit, assets);
  }

  /**
   * Lists the latest console messages and errors of the page.
   *
   * @param limit - Most entries to return.
   * @returns The messages, oldest first.
   */
  public console(limit: number): ConsoleEntry[] {
    return this.log.console(limit);
  }

  private async guard(route: Route): Promise<void> {
    const request = route.request();
    if (!request.isNavigationRequest()) return route.continue();
    let address = new URL(request.url());
    let method = request.method();
    for (let hop = 0; this.allows(address); hop++) {
      if (hop > MAX_REDIRECTS) return route.abort("failed");
      const next = hop === 0 ? {} : { url: address.href, method, ...(method === "GET" ? { postData: "" } : {}) };
      const response = await route.fetch({ ...next, maxRedirects: 0, timeout: this.timeouts.navigationMs }).catch(() => undefined);
      if (response === undefined) return route.abort("connectionfailed");
      const location = response.headers()["location"];
      if (response.status() < 300 || response.status() >= 400 || location === undefined) {
        return hop === 0 ? route.fulfill({ response }) : route.fulfill({ status: 302, headers: { location: address.href } });
      }
      if (response.status() !== 307 && response.status() !== 308) method = "GET";
      address = new URL(location, address);
    }
    this.log.refuse(request);
    return route.abort("aborted");
  }

  private allows(url: URL): boolean {
    return this.scope.origins.has(url.origin);
  }

  /** The error an agent reads when an action or a wait fails: why, then the page as it is now. */
  private async failed(failure: unknown, late: string, target?: Target): Promise<Error> {
    const reason = await this.reason(failure, late, target);
    const page = await this.snapshot().then(
      (snapshot) => `The page is now at ${snapshot.url}:\n${snapshot.page}`,
      (unreadable: unknown) => `The page cannot be read now: ${firstLine(unreadable)}`,
    );
    return new Error(`${reason}\n\n${page}`);
  }

  private async reason(failure: unknown, late: string, target: Target | undefined): Promise<string> {
    if (target === undefined) return failure instanceof errors.TimeoutError ? late : firstLine(failure);
    const code = targetCode(target);
    if (failure instanceof errors.TimeoutError) return (await locate(this.page, target).count()) === 0 ? `${code} matches no element.` : late;
    if (firstLine(failure).includes("strict mode violation")) return `${code} matches more than one element; use a locator that matches one.`;
    return firstLine(failure);
  }
}

function firstLine(failure: unknown): string {
  return (failure instanceof Error ? failure.message : String(failure)).split("\n")[0]!;
}
