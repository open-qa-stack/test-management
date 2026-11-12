import type { Page, Request } from "playwright-core";
import { shortText } from "./short-text.ts";

/** A request of the page, as the network tool shows it. */
export interface NetworkEntry {
  /** HTTP method. */
  readonly method: string;
  /** Address requested, cut when very long. */
  readonly url: string;
  /** What the browser fetched it as: `document`, `fetch`, `xhr`, `script`… */
  readonly resourceType: string;
  /** Status of the response, once one came. */
  readonly status?: number;
  /** Why no response came: a network failure, or a navigation the harness refused. */
  readonly failure?: string;
  /** Present while neither a response nor a failure came. */
  readonly pending?: true;
}

/** A message of the page's console, or an uncaught error of the page. */
export interface ConsoleEntry {
  /** `log`, `warning`, `error`…, or `pageerror` for an uncaught error. */
  readonly type: string;
  /** The message, cut when very long. */
  readonly text: string;
}

/** Resource types an agent reads by default: what the page asks of the servers, not its assets. */
const CALLS = new Set(["document", "fetch", "xhr"]);

/** Failure of a navigation the harness refused. */
export const REFUSED = "refused: the address is not one of the application's";

type Outcome = { readonly status: number } | { readonly failure: string };

/** A request as it is kept: its outcome comes later, if ever. */
interface Exchange {
  readonly request: Request;
  outcome?: Outcome;
}

/**
 * Keeps the last requests and console messages of a page, for the agent to read after an action.
 *
 * @remarks
 * A request is kept as soon as it leaves, so that one still in flight shows as pending. Only the
 * `capacity` most recent entries of each kind are kept, so that a long exploration does not grow without
 * bound.
 */
export class PageLog {
  private readonly capacity: number;
  private readonly exchanges: Exchange[] = [];
  private readonly messages: ConsoleEntry[] = [];

  /** @param capacity - Entries kept of each kind. */
  public constructor(capacity: number) {
    this.capacity = capacity;
  }

  /**
   * Starts recording what the page requests and logs.
   *
   * @param page - The page to listen to.
   */
  public listen(page: Page): void {
    page.on("request", (request) => {
      this.keep(this.exchanges, { request });
    });
    page.on("response", (response) => {
      this.settle(response.request(), { status: response.status() });
    });
    page.on("requestfailed", (request) => {
      // Playwright gives the reason of every request that failed.
      this.settle(request, { failure: (request.failure() as { errorText: string }).errorText });
    });
    page.on("console", (message) => {
      this.keep(this.messages, { type: message.type(), text: shortText(message.text()) });
    });
    page.on("pageerror", (error) => {
      this.keep(this.messages, { type: "pageerror", text: shortText(error.message) });
    });
  }

  /**
   * Records that the harness refused a navigation, in place of the failure the page sees for it.
   *
   * @param request - The refused request.
   */
  public refuse(request: Request): void {
    this.settle(request, { failure: REFUSED });
  }

  /**
   * Lists the latest requests of the page.
   *
   * @param limit - Most entries to return.
   * @param assets - Whether to include scripts, styles, images and fonts that did not fail.
   * @returns The most recent requests, oldest first.
   */
  public network(limit: number, assets: boolean): NetworkEntry[] {
    return this.exchanges
      .map(({ request, outcome }): NetworkEntry => ({ method: request.method(), url: shortText(request.url()), resourceType: request.resourceType(), ...(outcome ?? { pending: true }) }))
      .filter((entry) => assets || CALLS.has(entry.resourceType) || entry.failure !== undefined)
      .slice(-limit);
  }

  /**
   * Lists the latest console messages and page errors.
   *
   * @param limit - Most entries to return.
   * @returns The most recent ones, oldest first.
   */
  public console(limit: number): ConsoleEntry[] {
    return this.messages.slice(-limit);
  }

  /** Gives a kept request its outcome, once: a refusal is not overwritten by the failure it causes. */
  private settle(request: Request, outcome: Outcome): void {
    const exchange = this.exchanges.find((e) => e.request === request);
    if (exchange !== undefined && exchange.outcome === undefined) exchange.outcome = outcome;
  }

  private keep<T>(entries: T[], entry: T): void {
    entries.push(entry);
    if (entries.length > this.capacity) entries.shift();
  }
}
