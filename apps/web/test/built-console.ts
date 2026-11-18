import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { build } from "vite";
import { lineCoverage, type GeneratedMap, type LineCoverage } from "./line-coverage.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://console.test";

/** What the API answers to a request. */
export interface ApiAnswer {
  /** Its status; 200 by default. */
  readonly status?: number;
  /** Its media type; JSON by default. */
  readonly contentType?: string;
  readonly body: string;
}

/** A request of the console to the API of its instance. */
export interface ApiRequest {
  /** Its path, under `/api/`. */
  readonly path: string;
  readonly method: string;
  /** The event after which the console asks a stream to resume, when it opens one again. */
  readonly after?: string;
  /** Its body, for a request that carries one. */
  readonly body?: string;
}

/** What an instance that cannot be reached does to a request: it fails, without any answer. */
export const UNREACHABLE = "unreachable";

/** What the API does with a request: it answers, cannot be reached, or does not know the path. */
export type ApiOutcome = ApiAnswer | typeof UNREACHABLE | undefined;

/** The API of the instance, as a test plays it: what it does with a request, at once or once the test lets it. */
export type Api = (request: ApiRequest) => ApiOutcome | Promise<ApiOutcome>;

/** An API that knows no path: every request to it gets a 404. */
const NO_API: Api = () => undefined;

/**
 * The console built by Vite into a temporary folder, opened in Chromium without any network: its files come
 * from the build, and what it asks the API of its instance is answered by the test.
 */
export class BuiltConsole {
  readonly #outDir: string;
  readonly #browser: Browser;

  private constructor(outDir: string, browser: Browser) {
    this.#outDir = outDir;
    this.#browser = browser;
  }

  /** Builds the console with its source maps, then starts the browser; on failure, removes the build. */
  public static async start(): Promise<BuiltConsole> {
    const outDir = await mkdtemp(join(tmpdir(), "oqas-web-"));
    try {
      await build({ root: APP, logLevel: "silent", build: { outDir, emptyOutDir: true, sourcemap: true } });
      return new BuiltConsole(outDir, await chromium.launch());
    } catch (error) {
      await rm(outDir, { recursive: true, force: true });
      throw error;
    }
  }

  /**
   * Opens the console in a page of the given width; every request is answered from the build.
   *
   * @param width - The viewport width, in CSS pixels.
   * @param hash - The fragment of the address to open, such as `#/agent`.
   * @param api - What the API answers.
   * @returns The page, once the shell is mounted.
   */
  public async open(width: number, hash = "", api: Api = NO_API): Promise<Page> {
    const page = await this.#browser.newPage({ viewport: { width, height: 800 } });
    try {
      await this.#load(page, hash, api);
      return page;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  /**
   * Opens the console, uses it, and measures which lines of some source modules ran.
   *
   * @param sources - The paths of the modules, relative to the package.
   * @param use - What to do in the page once the shell is mounted.
   * @param api - What the API answers.
   * @returns For each module, the lines the build maps to, and those that did not run.
   */
  public async measure(sources: readonly string[], use: (page: Page) => Promise<void>, api: Api = NO_API): Promise<LineCoverage[]> {
    const page = await this.#browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await this.#load(page, "", api);
      await use(page);
      const scripts = await page.coverage.stopJSCoverage();
      return await Promise.all(
        sources.map(async (source) => {
          const measured = await Promise.all(
            scripts.map(async (script) => {
              const file = this.#file(script.url);
              const map = JSON.parse(await readFile(`${file}.map`, "utf8")) as GeneratedMap;
              const index = map.sources.findIndex((s) => resolve(dirname(file), s) === join(APP, source));
              return index < 0 ? undefined : lineCoverage(script, map, index);
            }),
          );
          const found = measured.filter((m) => m !== undefined);
          if (found.length !== 1) throw new Error(`${source} is in ${found.length} scripts of the build, not one`);
          return found[0]!;
        }),
      );
    } finally {
      await page.close();
    }
  }

  /** Closes the browser and removes the build. */
  public async stop(): Promise<void> {
    try {
      await this.#browser.close();
    } finally {
      await rm(this.#outDir, { recursive: true, force: true });
    }
  }

  async #load(page: Page, hash: string, api: Api): Promise<void> {
    await page.route("**/*", async (route) => {
      const { pathname, searchParams } = new URL(route.request().url());
      if (!pathname.startsWith("/api/")) return route.fulfill({ path: this.#file(route.request().url()) });
      const request = route.request();
      const after = searchParams.get("after");
      const body = request.postData();
      const answer = await api({
        path: pathname,
        method: request.method(),
        ...(after === null ? {} : { after }),
        ...(body === null ? {} : { body }),
      });
      if (answer === UNREACHABLE) return route.abort("connectionrefused");
      if (answer === undefined) return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
      return route.fulfill({ status: answer.status ?? 200, contentType: answer.contentType ?? "application/json", body: answer.body });
    });
    await page.goto(`${ORIGIN}/${hash}`);
    await page.locator(".shell").waitFor();
  }

  #file(url: string): string {
    const path = new URL(url).pathname;
    return join(this.#outDir, normalize(path === "/" ? "/index.html" : path));
  }
}
