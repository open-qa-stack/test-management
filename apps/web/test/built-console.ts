import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";
import { build } from "vite";
import { lineCoverage, type GeneratedMap, type LineCoverage } from "./line-coverage.ts";

const APP = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "http://console.test";

/** The console built by Vite into a temporary folder, opened in Chromium without any network. */
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
   * @returns The page, once the shell is mounted.
   */
  public async open(width: number): Promise<Page> {
    const page = await this.#browser.newPage({ viewport: { width, height: 800 } });
    try {
      await this.#load(page);
      return page;
    } catch (error) {
      await page.close();
      throw error;
    }
  }

  /**
   * Opens the console until the shell is mounted, and measures which lines of one source module ran.
   *
   * @param source - The path of the module, relative to the package.
   * @returns The lines of the module the build maps to, and those that did not run.
   */
  public async measure(source: string): Promise<LineCoverage> {
    const page = await this.#browser.newPage();
    try {
      await page.coverage.startJSCoverage({ resetOnNavigation: false });
      await this.#load(page);
      const scripts = await page.coverage.stopJSCoverage();
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

  async #load(page: Page): Promise<void> {
    await page.route("**/*", (route) => route.fulfill({ path: this.#file(route.request().url()) }));
    await page.goto(`${ORIGIN}/`);
    await page.locator(".shell").waitFor();
  }

  #file(url: string): string {
    const path = new URL(url).pathname;
    return join(this.#outDir, normalize(path === "/" ? "/index.html" : path));
  }
}
