import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { EventEmitter } from "node:events";
import net from "node:net";
import { chromium, type Page } from "playwright-core";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Application } from "@open-qa-stack/shared";
import { BrowserSession } from "../src/browser/browser-session.ts";
import { LOG_CAPACITY } from "../src/browser/application-page.ts";
import { readFacts, sameElement } from "../src/browser/element-facts.ts";
import { PageLog, REFUSED } from "../src/browser/page-log.ts";
import { MAX_ANNOTATED_ELEMENTS, MAX_SNAPSHOT_LENGTH, pageSnapshot } from "../src/browser/page-snapshot.ts";
import { recommendTarget } from "../src/browser/recommended-target.ts";
import { redact, SECRET_MASK, secretForms } from "../src/browser/redact.ts";
import { MAX_TEXT_LENGTH, shortText } from "../src/browser/short-text.ts";
import { closedPort, NetworkAccessError, testSite, type TestSite } from "@open-qa-stack/testing";
import { browserTools, type BrowserAccess, type BrowserToolset } from "../src/index.ts";

const PASSWORD = 'p@ss "word" 42';
const ENV = { SHOP_USER: "max@example.com", SHOP_PASSWORD: PASSWORD };

const HOME = `
<h1>My Policies</h1>
<label for="email">Email</label><input id="email">
<input id="pw" type="password" aria-label="Password">
<button onclick="out.textContent = 'Hello ' + email.value + ' ' + pw.value; console.log('signed in'); fetch('/api/ping')">Sign in</button>
<p id="out"></p>
<label for="promo">Promo</label><label for="promo">Code</label><input id="promo" data-testid="promo-field"><input aria-label="Promo Code">
<button aria-label="Save" data-testid="save-draft">Draft</button><button aria-label="Save" data-testid="save-final">Final</button>
<button data-testid="delete-1">✕</button><button data-testid="delete-2">✕</button>
<div style="cursor: pointer" onclick="this.textContent = 'Card opened'">Card</div>
<button>Again</button><button>Again</button>
<div style="cursor: pointer; text-transform: uppercase" onclick="void 0">open</div>
<div style="cursor: pointer" onclick="void 0"><svg width="10" height="10"></svg></div>
<div style="cursor: pointer" onclick="void 0"><span>Nested card</span></div>
<ul><li style="cursor: pointer">Policy 42</li></ul>
<button>Price: 10</button><button>It's: ok</button><button disabled>Locked</button>
<iframe srcdoc="<button>Inside</button>"></iframe>
<img alt="" src="/api/ping">
<input type="checkbox">
<select aria-label="Kind"><option>Home</option><option>Car</option></select>
<button onclick="console.error('boom'); throw new Error('kaput')">Break</button>
<button onclick="banner.hidden = true">Dismiss</button><p id="banner">Banner</p>
<a href="/second">Second</a>
<a id="away" href="#">Elsewhere</a>
`;

let site: TestSite;
let elsewhere: TestSite;
let screenshots: string;
let downPort: number;

before(async () => {
  downPort = await closedPort();
  elsewhere = await testSite({ "/": "<p>Elsewhere</p>", "/x": "<p>X</p>" });
  site = await testSite(
    {
      "/": HOME.replace('href="#"', `href="${elsewhere.origin}/x"`),
      "/second": "<h2>Second page</h2>",
      "/form": '<form method="post" action="/submit"><button>Send</button></form><form method="post" action="/keep"><button>Keep</button></form>',
      "/login": '<form method="get" action="/second"><input name="p" aria-label="Password" type="password"><button>Go</button></form>',
      "/broken": `<img alt="Logo" src="http://127.0.0.1:${downPort}/logo.png">`,
      "/chatty": `<script>for (let i = 0; i < ${LOG_CAPACITY + 10}; i++) console.log("line " + i);</script>`,
      "/many": Array.from({ length: MAX_ANNOTATED_ELEMENTS + 5 }, (_, i) => `<button>B${i}</button>`).join(""),
      "/text": Array.from({ length: 400 }, (_, i) => `<p>Paragraph ${i} with enough words to fill a line of the snapshot.</p>`).join(""),
    },
    {
      "/go": { status: 302, location: `${elsewhere.origin}/x` },
      "/hop": { status: 302, location: "/second" },
      "/hop2": { status: 301, location: "/hop3" },
      "/hop3": { status: 307, location: `${elsewhere.origin}/` },
      "/loop": { status: 302, location: "/loop" },
      "/submit": { status: 303, location: "/second" },
      "/keep": { status: 307, location: "/second" },
    },
  );
  screenshots = mkdtempSync(join(tmpdir(), "oqas-shots-"));
});

after(async () => {
  await site.close();
  await elsewhere.close();
  rmSync(screenshots, { recursive: true, force: true });
});

function applications(): Application[] {
  return [
    {
      id: "shop",
      name: "Shop",
      type: "web",
      authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
      environments: [
        { name: "local", uiUrl: site.origin, apis: [{ name: "api", baseUrl: `http://127.0.0.1:${downPort}` }] },
        { name: "staging" },
      ],
    },
    { id: "back-office", name: "Back office", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: `${site.origin}/second` }] },
    { id: "ledger", name: "Ledger", type: "api", authentication: { method: "none" }, environments: [{ name: "local", apis: [{ name: "api", baseUrl: site.origin }] }] },
  ];
}

/** Runs `use` with the browser tools of the test applications, then closes the browser. */
async function withTools<T>(use: (tool: (name: string) => ToolDefinition, toolset: BrowserToolset) => Promise<T>, access: Partial<BrowserAccess> = {}): Promise<T> {
  const toolset = browserTools(access.launch === undefined ? applications() : applications().slice(0, 1), {
    environment: "local",
    env: ENV,
    screenshotsDir: screenshots,
    actionTimeoutMs: 300,
    navigationTimeoutMs: 3000,
    ...access,
  });
  const tool = (name: string) => {
    const found = toolset.tools.find((t) => t.name === name);
    assert.ok(found, name);
    return found;
  };
  try {
    return await use(tool, toolset);
  } finally {
    await toolset.close();
  }
}

const page = async (tool: (name: string) => ToolDefinition, app = "shop") => ((await tool(`${app}_snapshot`).execute({})) as { page: string }).page;
const line = (text: string, element: string) => text.split("\n").find((l) => l.includes(element)) ?? `(no line with ${element})`;
const reject = (call: Promise<unknown>, message: RegExp) =>
  assert.rejects(call, (failure: unknown) => {
    assert.match(failure instanceof Error ? failure.message : String(failure), message);
    return true;
  });

describe("criterion 1 — a session gets the browser tools of each declared application, opened on its user interface", () => {
  it("names ten tools per application with a user interface in the environment, and none for the others", () => {
    const actions = ["goto", "snapshot", "click", "fill", "select_option", "check", "wait_for", "screenshot", "network", "console"];
    const local = browserTools(applications(), { environment: "local", env: ENV, screenshotsDir: screenshots });
    assert.deepEqual(local.tools.map((t) => t.name), [...actions.map((a) => `shop_${a}`), ...actions.map((a) => `back_office_${a}`)]);
    assert.deepEqual(browserTools(applications(), { environment: "staging", env: ENV, screenshotsDir: screenshots }).tools, []);
  });

  it("opens each application on its own user interface, in its own context", async () => {
    await withTools(async (tool) => {
      assert.equal(((await tool("shop_snapshot").execute({})) as { url: string }).url, `${site.origin}/`);
      assert.match(await page(tool, "back_office"), /heading "Second page"/);
      assert.match(await page(tool), /heading "My Policies"/);
    });
  });

  it("opens an address of the application, absolute or relative", async () => {
    await withTools(async (tool) => {
      assert.deepEqual(await tool("shop_goto").execute({ url: "/second" }), { url: `${site.origin}/second`, title: "/second" });
      assert.deepEqual(await tool("shop_goto").execute({ url: `${site.origin}/` }), { url: `${site.origin}/`, title: "/" });
    });
  });

  it("refuses an address of another host, before any request reaches it", async () => {
    await withTools(async (tool) => {
      await reject(tool("shop_goto").execute({ url: `${elsewhere.origin}/` }), new RegExp(`is not an address of shop; allowed origins: ${site.origin}, http://127.0.0.1:${downPort}\\.`));
      await reject(tool("shop_goto").execute({ url: "http://[" }), /^http:\/\/\[ is not an address of shop/);
      assert.deepEqual(elsewhere.requested, []);
    });
  });

  it("refuses a navigation to another host started by the page, and shows it among the requests", async () => {
    await withTools(async (tool) => {
      assert.deepEqual(await tool("shop_click").execute({ target: { role: "link", name: "Elsewhere" } }), { url: `${site.origin}/`, title: "/" });
      const refused = ((await tool("shop_network").execute({})) as { url: string; failure?: string }[]).filter((entry) => entry.failure === REFUSED);
      assert.deepEqual(refused.map((entry) => entry.url), [`${elsewhere.origin}/x`]);
      assert.deepEqual(elsewhere.requested, []);
    });
  });

  it("refuses a redirect to another host, at any hop, before any request reaches it", async () => {
    await withTools(async (tool) => {
      await reject(tool("shop_goto").execute({ url: "/go" }), /^http:\/\/127\.0\.0\.1:\d+\/go did not load: .*ERR_ABORTED/);
      await reject(tool("shop_goto").execute({ url: "/hop2" }), /did not load: .*ERR_ABORTED/);
      assert.deepEqual(elsewhere.requested, []);
      const refused = ((await tool("shop_network").execute({})) as { url: string; failure?: string }[]).filter((entry) => entry.failure === REFUSED);
      assert.deepEqual(refused.map((entry) => new URL(entry.url).pathname), ["/go", "/hop2"]);
      assert.deepEqual(await tool("shop_goto").execute({ url: "/hop" }), { url: `${site.origin}/second`, title: "/second" });
      await reject(tool("shop_goto").execute({ url: "/loop" }), /did not load: .*ERR_FAILED/);
    });
  });

  it("sends a form once, and follows its redirect by GET", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/form" });
      await tool("shop_click").execute({ target: { role: "button", name: "Send" } });
      assert.deepEqual(await tool("shop_wait_for").execute({ urlIncludes: "/second" }), { url: `${site.origin}/second`, title: "/second" });
      assert.deepEqual(site.requested.filter((r) => r.includes("/submit")), ["POST /submit"]);
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
      await reject(tool("shop_goto").execute({ url: `http://127.0.0.1:${downPort}/` }), new RegExp(`^http://127\\.0\\.0\\.1:${downPort}/ did not load: .*ERR_CONNECTION_FAILED`));
    });
  });

  it("says when the user interface cannot be loaded, and tries again at the next call", async () => {
    const down: Application = { id: "down", name: "Down", type: "web", authentication: { method: "none" }, environments: [{ name: "local", uiUrl: `http://127.0.0.1:${downPort}` }] };
    const toolset = browserTools([down], { environment: "local", env: {}, screenshotsDir: screenshots, navigationTimeoutMs: 3000 });
    try {
      const snapshot = toolset.tools.find((t) => t.name === "down_snapshot")!;
      await reject(snapshot.execute({}), new RegExp(`^The user interface of down at http://127\\.0\\.0\\.1:${downPort} cannot be loaded: .*ERR_CONNECTION_FAILED`));
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
    const launch = () => new Promise<never>((_, refuse) => setTimeout(() => refuse(new Error("too late")), 20));
    const toolset = browserTools(applications().slice(0, 1), { environment: "local", env: ENV, screenshotsDir: screenshots, launch });
    const call = toolset.tools[1]!.execute({});
    await toolset.close();
    await reject(call, /too late/);
  });
});

describe("criterion 2 — a snapshot lists the elements one can act on, with role, name and recommended locator", () => {
  it("recommends the locator by role and name, then label, then test id, then text, in that order", async () => {
    await withTools(async (tool) => {
      const text = await page(tool);
      assert.match(line(text, 'button "Sign in"'), / → page\.getByRole\("button", \{ name: "Sign in", exact: true \}\)$/);
      assert.match(line(text, 'textbox "Email"'), / → page\.getByRole\("textbox", \{ name: "Email", exact: true \}\)$/);
      assert.match(text.split("\n").filter((l) => l.includes('textbox "Promo Code"'))[0]!, / → page\.getByLabel\("Promo", \{ exact: true \}\)$/);
      assert.deepEqual(
        text.split("\n").filter((l) => l.includes('button "Save"')).map((l) => l.split(" → ")[1]),
        ['page.getByTestId("save-draft")', 'page.getByTestId("save-final")'],
      );
      assert.match(line(text, "Price: 10"), /^ *- 'button "Price: 10" \[ref=e\d+\]' → page\.getByRole\("button", \{ name: "Price: 10", exact: true \}\)$/);
      assert.match(line(text, "It''s: ok"), / → page\.getByRole\("button", \{ name: "It's: ok", exact: true \}\)$/);
      assert.match(line(text, "listitem"), /listitem \[ref=e\d+\] \[cursor=pointer\]: Policy 42 → page\.getByRole\("listitem"\)$/);
      assert.deepEqual(
        text.split("\n").filter((l) => l.includes('button "✕"')).map((l) => l.split(" → ")[1]),
        ['page.getByTestId("delete-1")', 'page.getByTestId("delete-2")'],
      );
      assert.match(line(text, "Card"), /generic \[ref=e\d+\] \[cursor=pointer\]: Card → page\.getByText\("Card", \{ exact: true \}\)$/);
      assert.match(line(text, "checkbox"), / → page\.getByRole\("checkbox"\)$/);
    });
  });

  it("says when no locator matches one element only, and when none applies", async () => {
    await withTools(async (tool) => {
      const text = await page(tool);
      assert.match(line(text, 'button "Again"'), / → no unique locator: 2 elements match page\.getByRole\("button", \{ name: "Again", exact: true \}\)$/);
      assert.match(line(text, "open"), / → page\.getByText\("open", \{ exact: true \}\)$/);
      assert.match(text, /generic \[ref=e\d+\] \[cursor=pointer\] → no locator by role, label, test id or text$/m);
      assert.doesNotMatch(line(text, "Nested card"), /getByText/);
      assert.match(line(text, 'button "Inside"'), / → inside a frame: these tools cannot reach it$/);
      assert.match(line(text, 'button "Locked"'), / → page\.getByRole/);
      assert.doesNotMatch(line(text, 'heading "My Policies"'), /→/);
    });
  });

  it("recommends a locator for a bounded number of elements, and cuts a long page at a line", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/many" });
      const many = (await tool("shop_snapshot").execute({})) as { page: string; truncated: boolean };
      assert.ok(many.page.split("\n").filter((l) => l.includes(" → ")).length <= MAX_ANNOTATED_ELEMENTS);
      assert.equal(many.truncated, true);
      await tool("shop_goto").execute({ url: "/text" });
      const long = (await tool("shop_snapshot").execute({})) as { page: string; truncated: boolean };
      assert.equal(long.truncated, true);
      assert.ok(long.page.length <= MAX_SNAPSHOT_LENGTH);
      assert.match(long.page.split("\n").at(-1)!, /Paragraph \d+ with enough words/);
      await tool("shop_goto").execute({ url: "/second" });
      assert.equal(((await tool("shop_snapshot").execute({})) as { truncated: boolean }).truncated, false);
    });
  });

  it("reads the label, test id and text of an element in the page, and tells two elements apart", () => {
    const element = (attributes: Record<string, string>, more: object = {}) => ({ getAttribute: (name: string) => attributes[name] ?? null, textContent: null, ...more });
    assert.deepEqual(readFacts(element({ "data-testid": "t" }, { labels: [{ textContent: " Promo " }], textContent: " Go\n  now " })), { testId: "t", label: "Promo", text: "Go now" });
    assert.deepEqual(readFacts(element({ "aria-label": "Code" }, { labels: [], textContent: "" })), { testId: null, label: "Code", text: "" });
    assert.deepEqual(readFacts(element({ "aria-label": "" }, { labels: [{ textContent: null }] })), { testId: null, label: null, text: "" });
    assert.deepEqual(readFacts(element({}, { labels: null })), { testId: null, label: null, text: "" });
    const one = {};
    assert.deepEqual([sameElement(one, one), sameElement(one, {})], [true, false]);
  });

  it("marks an element the page replaced while the snapshot was taken, without failing the snapshot", async () => {
    const gone = { getByRef: () => ({ elementHandle: () => Promise.reject(new Error("element was detached")) }) };
    assert.deepEqual(await recommendTarget(gone as unknown as Page, "e1", "button", "Save"), { kind: "changed" });
    let disposed = false;
    const handle = { evaluate: () => Promise.reject(new Error("element was detached")), dispose: async () => void (disposed = true) };
    const replaced = { getByRef: () => ({ elementHandle: async () => handle }) };
    assert.deepEqual(await recommendTarget(replaced as unknown as Page, "e1", "button", "Save"), { kind: "changed" });
    assert.equal(disposed, true);
    const page = { ...gone, ariaSnapshot: async () => '- button "Save" [ref=e1]', url: () => "http://shop.test/", title: async () => "Shop" };
    assert.deepEqual(await pageSnapshot(page as unknown as Page), {
      url: "http://shop.test/",
      title: "Shop",
      page: '- button "Save" [ref=e1] → the element changed while the snapshot was taken; take another one',
      truncated: false,
    });
  });
});

describe("criterion 3 — actions use the recommended locators, and a failed action says why with the page", () => {
  it("fills and clicks by role, label and test id", async () => {
    await withTools(async (tool) => {
      await tool("shop_fill").execute({ target: { label: "Email" }, value: "eve@example.com" });
      await tool("shop_fill").execute({ target: { label: "Promo" }, value: "SPRING" });
      await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } });
      await tool("shop_click").execute({ target: { testId: "delete-1" } });
      await tool("shop_click").execute({ target: { text: "Card" } });
      const text = await page(tool);
      assert.match(text, /paragraph \[ref=e\d+\]: Hello eve@example\.com$/m);
      assert.match(text, /textbox "Promo Code" \[ref=e\d+\]: SPRING →/);
      assert.match(text, /: Card opened/);
    });
  });

  it("chooses an option, checks a box, and waits for an element, a hidden one or an address", async () => {
    await withTools(async (tool) => {
      await tool("shop_select_option").execute({ target: { role: "combobox", name: "Kind" }, option: "Car" });
      await tool("shop_check").execute({ target: { role: "checkbox" }, checked: true });
      await tool("shop_wait_for").execute({ target: { text: "Banner" } });
      await tool("shop_click").execute({ target: { role: "button", name: "Dismiss" } });
      await tool("shop_wait_for").execute({ target: { text: "Banner" }, state: "hidden", timeoutMs: 1000 });
      const text = await page(tool);
      assert.match(text, /option "Car" \[selected\]/);
      assert.match(text, /checkbox \[checked\]/);
      await tool("shop_click").execute({ target: { role: "link", name: "Second" } });
      assert.deepEqual(await tool("shop_wait_for").execute({ urlIncludes: "/second" }), { url: `${site.origin}/second`, title: "/second" });
    });
  });

  it("says that an element is missing, or not unique, followed by the page as it is now", async () => {
    await withTools(async (tool) => {
      await reject(
        tool("shop_click").execute({ target: { role: "button", name: "Missing" } }),
        new RegExp(`^page\\.getByRole\\("button", \\{ name: "Missing", exact: true \\}\\) matches no element\\.\\n\\nThe page is now at ${site.origin}/:\\n- generic`),
      );
      await reject(tool("shop_click").execute({ target: { role: "button", name: "Locked" } }), /^page\.getByRole\("button", \{ name: "Locked", exact: true \}\) did not become ready within 300 ms\.\n\nThe page is now at/);
      await reject(tool("shop_click").execute({ target: { text: "Again" } }), /^page\.getByText\("Again", \{ exact: true \}\) matches more than one element; use a locator that matches one\.\n\nThe page is now at/);
      await reject(tool("shop_fill").execute({ target: { role: "button", name: "Sign in" }, value: "x" }), /Element is not an <input>.*\n\nThe page is now at/s);
      await reject(tool("shop_wait_for").execute({ target: { text: "Never" }, timeoutMs: 100 }), /^page\.getByText\("Never", \{ exact: true \}\) matches no element\./);
      await reject(tool("shop_wait_for").execute({ target: { text: "Banner" }, state: "hidden", timeoutMs: 100 }), /^page\.getByText\("Banner", \{ exact: true \}\) did not become hidden within 100 ms\./);
      await reject(tool("shop_wait_for").execute({ urlIncludes: "/never", timeoutMs: 100 }), /^The address did not come to include "\/never" within 100 ms\.\n\nThe page is now at/);
    });
  });

  it("refuses a wait that names both an element and an address, or neither", async () => {
    await withTools(async (tool) => {
      const { parameters } = tool("shop_wait_for");
      const { Ajv2020 } = await import("ajv/dist/2020.js");
      const valid = new Ajv2020({ strict: false }).compile(parameters);
      assert.equal(valid({ target: { text: "x" }, urlIncludes: "/a" }), false);
      assert.equal(valid({ urlIncludes: "/a", state: "hidden" }), false);
      assert.equal(valid({}), false);
      assert.equal(valid({ target: { text: "x" }, state: "hidden" }), true);
    });
  });

  it("reports what an action threw when it is not an error, and a page it cannot read", async () => {
    const session = new BrowserSession(() => chromium.launch(), { actionMs: 300, navigationMs: 3000 });
    try {
      const shop = await session.page({ applicationId: "shop", uiUrl: site.origin, origins: new Set([site.origin]) });
      await reject(
        shop.act({ text: "Card" }, () => Promise.reject("plain")),
        /^plain\n\nThe page is now at/,
      );
      await reject(
        shop.act({ text: "Card" }, async (card) => {
          await card.page().close();
          throw new Error("closed");
        }),
        /^closed\n\nThe page cannot be read now: /,
      );
      await reject(shop.waitFor({ urlIncludes: "/second" }, 100), /has been closed.*\n\nThe page cannot be read now: /);
    } finally {
      await session.close();
    }
  });
});

describe("criterion 4 — actions count against the task's action limit, snapshots and reads do not", () => {
  it("marks the tools that change the page as browser actions", () => {
    const { tools } = browserTools(applications().slice(0, 1), { environment: "local", env: ENV, screenshotsDir: screenshots });
    assert.deepEqual(
      tools.filter((t) => t.browserAction === true).map((t) => t.name),
      ["shop_goto", "shop_click", "shop_fill", "shop_select_option", "shop_check"],
    );
  });
});

describe("criterion 5 — the agent reads the requests and the console of the page", () => {
  it("lists the document and the API calls, and the assets when asked", async () => {
    await withTools(async (tool) => {
      await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } });
      await tool("shop_wait_for").execute({ target: { text: "Card" } });
      const calls = async (args: object) => ((await tool("shop_network").execute(args)) as { method: string; url: string; resourceType: string; status?: number }[]);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.deepEqual(await calls({}), [
        { method: "GET", url: `${site.origin}/`, resourceType: "document", status: 200 },
        { method: "GET", url: `${site.origin}/api/ping`, resourceType: "fetch", status: 200 },
      ]);
      assert.deepEqual((await calls({ limit: 1 })).map((c) => c.url), [`${site.origin}/api/ping`]);
      assert.deepEqual(
        (await calls({ assets: true })).filter((c) => c.resourceType === "image").map((c) => [c.url, c.status]),
        [[`${site.origin}/api/ping`, 200]],
      );
    });
  });

  it("shows a failed request even when it is an asset", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/broken" });
      const failed = ((await tool("shop_network").execute({})) as { url: string; resourceType: string; failure?: string }[]).filter((entry) => entry.failure !== undefined);
      assert.deepEqual(failed.map((entry) => [entry.url, entry.resourceType]), [[`http://127.0.0.1:${downPort}/logo.png`, "image"]]);
      assert.match(failed[0]!.failure!, /ERR_CONNECTION_REFUSED/);
    });
  });

  it("shows a request still in flight as pending, and keeps only the latest requests", () => {
    const page = new EventEmitter();
    const log = new PageLog(2);
    log.listen(page as unknown as Page);
    const request = (url: string) => ({ method: () => "GET", url: () => url, resourceType: () => "fetch", failure: () => ({ errorText: "net::ERR_FAILED" }) });
    const [a, b, c] = [request("http://shop.test/a"), request("http://shop.test/b"), request("http://shop.test/c")];
    page.emit("request", a);
    page.emit("request", b);
    page.emit("response", { request: () => a, status: () => 200 });
    assert.deepEqual(log.network(10, false), [
      { method: "GET", url: "http://shop.test/a", resourceType: "fetch", status: 200 },
      { method: "GET", url: "http://shop.test/b", resourceType: "fetch", pending: true },
    ]);
    page.emit("request", c);
    page.emit("response", { request: () => a, status: () => 500 });
    page.emit("requestfailed", c);
    assert.deepEqual(log.network(10, false).map((e) => [new URL(e.url).pathname, e.status ?? e.failure ?? "pending"]), [["/b", "pending"], ["/c", "net::ERR_FAILED"]]);
  });

  it("keeps only the latest entries", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/chatty" });
      const lines = (await tool("shop_console").execute({ limit: LOG_CAPACITY })) as { text: string }[];
      assert.equal(lines.length, LOG_CAPACITY);
      assert.deepEqual([lines[0]!.text, lines.at(-1)!.text], ["line 10", `line ${LOG_CAPACITY + 9}`]);
    });
  });

  it("lists console messages and uncaught errors, the latest last", async () => {
    await withTools(async (tool) => {
      await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } });
      await tool("shop_click").execute({ target: { role: "button", name: "Break" } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(await tool("shop_console").execute({}), [
        { type: "log", text: "signed in" },
        { type: "error", text: "boom" },
        { type: "pageerror", text: "kaput" },
      ]);
      assert.deepEqual(await tool("shop_console").execute({ limit: 1 }), [{ type: "pageerror", text: "kaput" }]);
    });
  });
});

describe("criterion 6 — the tests run on a page served locally, without network or model", () => {
  it("serves the example pages on the loopback interface, and refuses any other connection", () => {
    assert.match(site.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.throws(() => net.connect(80, "192.0.2.1"), NetworkAccessError);
  });
});

describe("test accounts — the agent types them by name, and their passwords never reach the model", () => {
  it("types a declared account by its name, and masks its password in everything returned, in every form", async () => {
    await withTools(async (tool) => {
      await tool("shop_fill").execute({ target: { label: "Email" }, value: { account: "demo", field: "username" } });
      await tool("shop_fill").execute({ target: { role: "textbox", name: "Password" }, value: { account: "demo", field: "password" } });
      const returned = [await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } }), await tool("shop_snapshot").execute({})];
      const text = await page(tool);
      assert.match(text, new RegExp(`Hello max@example\\.com \\${SECRET_MASK}`));
      await tool("shop_goto").execute({ url: "/login" });
      await tool("shop_fill").execute({ target: { role: "textbox", name: "Password" }, value: { account: "demo", field: "password" } });
      returned.push(await tool("shop_snapshot").execute({}), await tool("shop_click").execute({ target: { role: "button", name: "Go" } }));
      returned.push(await tool("shop_network").execute({}));
      await reject(tool("shop_goto").execute({ url: `${elsewhere.origin}/?q=${encodeURIComponent(PASSWORD)}` }), new RegExp(`\\?q=\\${SECRET_MASK} is not an address`));
      const all = JSON.stringify(returned);
      for (const form of secretForms(PASSWORD)) assert.ok(!all.includes(form), form);
      assert.match(all, /\/second\?p=\[secret\]/);
    });
  });

  it("refuses an unknown account, or one whose variable is not set", async () => {
    await withTools(async (tool) => {
      await reject(tool("shop_fill").execute({ target: { label: "Email" }, value: { account: "root", field: "username" } }), /^shop has no test account named root; accounts: demo\.$/);
    });
    await withTools(
      async (tool) => {
        await reject(tool("shop_fill").execute({ target: { label: "Email" }, value: { account: "demo", field: "password" } }), /^Environment variable SHOP_PASSWORD is not set\.$/);
        assert.match(tool("back_office_fill").description, /Accounts: none\./);
      },
      { env: { SHOP_USER: "max@example.com", SHOP_PASSWORD: "" } },
    );
  });

  it("lists the forms a secret may take: as it is, escaped, with spaces collapsed, encoded in an address", () => {
    assert.deepEqual(secretForms('a "b"  c&'), ['a "b"  c&', 'a \\"b\\"  c&', 'a "b" c&', "a%20%22b%22%20%20c%26", "a+%22b%22++c%26"]);
    assert.deepEqual(secretForms("plain"), ["plain"]);
  });

  it("replaces every secret in nested values, the longest first", () => {
    const value = { a: ["abcdef", 3, null, { b: "xabcx" }], c: true };
    assert.deepEqual(redact(value, ["abc", "abcdef"]), { a: [SECRET_MASK, 3, null, { b: `x${SECRET_MASK}x` }], c: true });
    assert.equal(redact(value, []), value);
  });
});

describe("texts the page controls", () => {
  it("are cut when very long", () => {
    assert.equal(shortText("x".repeat(MAX_TEXT_LENGTH)), "x".repeat(MAX_TEXT_LENGTH));
    assert.equal(shortText("x".repeat(MAX_TEXT_LENGTH + 1)), `${"x".repeat(MAX_TEXT_LENGTH)}…`);
  });
});

describe("screenshots", () => {
  it("writes a numbered image of the viewport, or of the whole page", async () => {
    await withTools(async (tool) => {
      const first = (await tool("shop_screenshot").execute({})) as { path: string };
      const second = (await tool("shop_screenshot").execute({ fullPage: true })) as { path: string };
      assert.deepEqual([first.path, second.path], [join(screenshots, "shop-1.png"), join(screenshots, "shop-2.png")]);
      assert.ok(existsSync(first.path) && existsSync(second.path));
    });
  });
});
