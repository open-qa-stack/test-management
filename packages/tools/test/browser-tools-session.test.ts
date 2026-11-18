import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Application } from "@open-qa-stack/domain";
import { REFUSED } from "../src/browser/page-log.ts";
import { browserTools } from "../src/index.ts";
import { ENV, site, elsewhere, api, screenshots, downPort, applications, withTools, page, reject } from "./browser-tools-support.ts";

describe("criterion 1 — a session gets the browser tools of each declared application, opened on its user interface", () => {
  it("names ten tools per application with a user interface in the environment, and none for the others", () => {
    const actions = ["goto", "snapshot", "click", "fill", "select_option", "check", "wait_for", "screenshot", "network", "console"];
    const local = browserTools(applications(), { environment: "local", env: ENV, screenshotsDir: screenshots });
    assert.deepEqual(
      local.tools.map((t) => t.name),
      [...actions.map((a) => `shop_${a}`), ...actions.map((a) => `back_office_${a}`)],
    );
    assert.deepEqual(browserTools(applications(), { environment: "staging", env: ENV, screenshotsDir: screenshots }).tools, []);
  });

  it("opens each application on its own user interface, in its own context", async () => {
    await withTools(async (tool) => {
      assert.equal(((await tool("shop_snapshot").execute({})) as { url: string }).url, `${site.origin}/`);
      assert.match(await page(tool, "back_office"), /heading "Second page"/);
      assert.match(await page(tool), /heading "My Policies"/);
    });
  });

  it("opens an address of the application, absolute or relative, and gives the line a test writes, by its path on the user interface", async () => {
    await withTools(async (tool) => {
      assert.deepEqual(await tool("shop_goto").execute({ url: "/second" }), {
        url: `${site.origin}/second`,
        title: "/second",
        code: 'await page.goto("/second");',
      });
      assert.deepEqual(await tool("shop_goto").execute({ url: `${site.origin}/?tab=1#top` }), {
        url: `${site.origin}/?tab=1#top`,
        title: "/",
        code: 'await page.goto("/?tab=1#top");',
      });
      // An address of an API of the application is given whole: it is not on the user interface.
      assert.equal(((await tool("back_office_goto").execute({ url: `${api.origin}/x` })) as { code: string }).code, `await page.goto("${api.origin}/x");`);
    });
  });

  it("refuses an address of another host, before any request reaches it", async () => {
    await withTools(async (tool) => {
      await reject(
        tool("shop_goto").execute({ url: `${elsewhere.origin}/` }),
        new RegExp(`is not an address of shop; allowed origins: ${site.origin}, http://127.0.0.1:${downPort}\\.`),
      );
      await reject(tool("shop_goto").execute({ url: "http://[" }), /^http:\/\/\[ is not an address of shop/);
      assert.deepEqual(elsewhere.requested, []);
    });
  });

  it("refuses a navigation to another host started by the page, and shows it among the requests", async () => {
    await withTools(async (tool) => {
      assert.deepEqual(await tool("shop_click").execute({ target: { role: "link", name: "Elsewhere" } }), {
        url: `${site.origin}/`,
        title: "/",
        code: 'await page.getByRole("link", { name: "Elsewhere", exact: true }).click();',
      });
      const refused = ((await tool("shop_network").execute({})) as { url: string; failure?: string }[]).filter((entry) => entry.failure === REFUSED);
      assert.deepEqual(
        refused.map((entry) => entry.url),
        [`${elsewhere.origin}/x`],
      );
      assert.deepEqual(elsewhere.requested, []);
    });
  });

  it("refuses a redirect to another host, at any hop, before any request reaches it", async () => {
    await withTools(async (tool) => {
      await reject(tool("shop_goto").execute({ url: "/go" }), /^http:\/\/127\.0\.0\.1:\d+\/go did not load: .*ERR_ABORTED/);
      await reject(tool("shop_goto").execute({ url: "/hop2" }), /did not load: .*ERR_ABORTED/);
      assert.deepEqual(elsewhere.requested, []);
      const refused = ((await tool("shop_network").execute({})) as { url: string; failure?: string }[]).filter((entry) => entry.failure === REFUSED);
      assert.deepEqual(
        refused.map((entry) => new URL(entry.url).pathname),
        ["/go", "/hop2"],
      );
      assert.deepEqual(await tool("shop_goto").execute({ url: "/hop" }), { url: `${site.origin}/second`, title: "/second", code: 'await page.goto("/hop");' });
      await reject(tool("shop_goto").execute({ url: "/loop" }), /did not load: .*ERR_FAILED/);
    });
  });

  it("sends a form once, and follows its redirect by GET", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/form" });
      await tool("shop_click").execute({ target: { role: "button", name: "Send" } });
      assert.deepEqual(await tool("shop_wait_for").execute({ urlIncludes: "/second" }), { url: `${site.origin}/second`, title: "/second" });
      assert.deepEqual(
        site.requested.filter((r) => r.includes("/submit")),
        ["POST /submit"],
      );
    });
  });

  it("keeps the method of a form through a 307 redirect", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/form" });
      const before = site.requested.length;
      await tool("shop_click").execute({ target: { role: "button", name: "Keep" } });
      await tool("shop_wait_for").execute({ urlIncludes: "/second" });
      assert.deepEqual(site.requested.slice(before), ["POST /keep", "POST /second", "GET /second"]);
    });
  });

  it("says when an address of the application does not load", async () => {
    await withTools(async (tool) => {
      await reject(
        tool("shop_goto").execute({ url: `http://127.0.0.1:${downPort}/` }),
        new RegExp(`^http://127\\.0\\.0\\.1:${downPort}/ did not load: .*ERR_CONNECTION_FAILED`),
      );
    });
  });

  it("says when the user interface cannot be loaded, and tries again at the next call", async () => {
    const down: Application = {
      id: "down",
      name: "Down",
      type: "web",
      authentication: { method: "none" },
      environments: [{ name: "local", uiUrl: `http://127.0.0.1:${downPort}` }],
    };
    const toolset = browserTools([down], { environment: "local", env: {}, screenshotsDir: screenshots });
    try {
      const snapshot = toolset.tools.find((t) => t.name === "down_snapshot")!;
      await reject(
        snapshot.execute({}),
        new RegExp(`^The user interface of down at http://127\\.0\\.0\\.1:${downPort} cannot be loaded: .*ERR_CONNECTION_FAILED`),
      );
      await reject(snapshot.execute({}), /cannot be loaded/);
    } finally {
      await toolset.close();
    }
  });

  it("starts the browser at the first call only, and tries again when it did not start", async () => {
    let launches = 0;
    const launch = async () => {
      launches++;
      throw "no browser";
    };
    await withTools(
      async (tool) => {
        assert.equal(launches, 0);
        await reject(tool("shop_snapshot").execute({}), /^no browser$/);
        await reject(tool("shop_snapshot").execute({}), /^no browser$/);
        assert.equal(launches, 2);
      },
      { launch },
    );
  });

  it("closes a browser that is still starting", async () => {
    let refuse: (failure: Error) => void = () => undefined;
    let launched: () => void = () => undefined;
    const starting = new Promise<void>((resolve) => (launched = resolve));
    const launch = () => {
      launched();
      return new Promise<never>((_, fail) => (refuse = fail));
    };
    const toolset = browserTools(applications().slice(0, 1), { environment: "local", env: ENV, screenshotsDir: screenshots, launch });
    const call = toolset.tools[1]!.execute({});
    await starting;
    const closing = toolset.close();
    refuse(new Error("too late"));
    await closing;
    await reject(call, /too late/);
  });
});
