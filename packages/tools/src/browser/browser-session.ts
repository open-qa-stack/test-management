import type { Browser } from "playwright-core";
import { ApplicationPage, type PageScope, type PageTimeouts } from "./application-page.ts";

/**
 * The browser of an agent session, with one page per application, all opened on first use.
 *
 * @remarks
 * A session that never calls a browser tool starts no browser. A launch or an opening that fails is not
 * kept, so that a later call tries again.
 */
export class BrowserSession {
  private readonly launch: () => Promise<Browser>;
  private readonly timeouts: PageTimeouts;
  private browser: Promise<Browser> | undefined;
  private readonly pages = new Map<string, Promise<ApplicationPage>>();

  /**
   * @param launch - Starts the browser.
   * @param timeouts - How long pages wait.
   */
  public constructor(launch: () => Promise<Browser>, timeouts: PageTimeouts) {
    this.launch = launch;
    this.timeouts = timeouts;
  }

  /**
   * Gives the page of an application.
   *
   * @param scope - The application's addresses.
   * @returns Its page, opened on its user interface the first time.
   * @throws Error when the browser does not start or the user interface does not load.
   */
  public page(scope: PageScope): Promise<ApplicationPage> {
    let page = this.pages.get(scope.applicationId);
    if (page === undefined) {
      page = this.started().then((browser) => ApplicationPage.open(browser, scope, this.timeouts));
      this.pages.set(scope.applicationId, page);
      page.catch(() => this.pages.delete(scope.applicationId));
    }
    return page;
  }

  /** Closes the browser, and every page with it, even while it is still starting. */
  public async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.pages.clear();
    await (await browser?.catch(() => undefined))?.close();
  }

  private started(): Promise<Browser> {
    this.browser ??= this.launch().catch((failure: unknown) => {
      this.browser = undefined;
      throw failure;
    });
    return this.browser;
  }
}
