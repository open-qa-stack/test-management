import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vitest";
import type { ToolDefinition } from "@open-qa-stack/domain";
import type { Application } from "@open-qa-stack/shared";
import { LOG_CAPACITY } from "../src/browser/application-page.ts";
import { MAX_ANNOTATED_ELEMENTS } from "../src/browser/page-snapshot.ts";
import { closedPort, testSite, type TestSite } from "@open-qa-stack/testing";
import { ACTION_TIMEOUT_MS } from "../src/browser/browser-tools.ts";
import { browserTools, type BrowserAccess, type BrowserToolset } from "../src/index.ts";

export const PASSWORD = 'p@ss "word" 42';

export const ENV = { SHOP_USER: "max@example.com", SHOP_PASSWORD: PASSWORD };

export const HOME = `
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

export let site: TestSite;

export let elsewhere: TestSite;

/** The API of the back office, on an origin of its own. */
export let api: TestSite;

export let screenshots: string;

export let downPort: number;

beforeAll(async () => {
  downPort = await closedPort();
  elsewhere = await testSite({ "/": "<p>Elsewhere</p>", "/x": "<p>X</p>" });
  api = await testSite({ "/x": "<p>X</p>" });
  site = await testSite(
    {
      "/": HOME.replace('href="#"', `href="${elsewhere.origin}/x"`),
      "/second": "<h2>Second page</h2>",
      // A page with a button that removes an order.
      "/removes": `<p id="order">Order 42</p><button onclick="order.remove()">Delete order</button><button onclick="order.textContent = 'Order 42, kept'">Keep</button>`,
      // Elements repeated from one row or dialog to the next, from one list item to the next, which no locator names, and on rows of the same name.
      "/rows": `<table><tr><td></td><td>Lena Veldane</td><td><button onclick="out.textContent = 'Managing Lena'">Manage</button></td></tr><tr><td>Tom Arvel</td><td><button>Manage</button></td></tr></table>
<ul><li><span>Lena Veldane</span><button>Open</button></li><li><span>Tom Arvel</span><button>Open</button></li></ul>
<table><tr><td>Same</td><td><button>Edit</button></td></tr><tr><td>Same</td><td><button>Edit</button></td></tr></table>
<dialog open><button>Close</button></dialog><button>Close</button><p id="out"></p>`,
      // A page that loads its data from another local service, at once and on demand, as an interface does from its API.
      "/loads": `<p id="data">loading</p><button onclick="fetch('/api/ping').then(() => { document.getElementById('more').hidden = false; })">More</button><p id="more" hidden>More data</p><script>fetch("${elsewhere.origin}/api/ping").then((r) => r.json()).then((body) => { document.getElementById("data").textContent = "pong " + body.pong; }, () => { document.getElementById("data").textContent = "refused"; });</script>`,
      "/hangs": '<p id="data">waiting</p><script>fetch("/api/hang").then(() => { document.getElementById("data").textContent = "answered"; });</script>',
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

afterAll(async () => {
  await site.close();
  await elsewhere.close();
  await api.close();
  rmSync(screenshots, { recursive: true, force: true });
});

export function applications(): Application[] {
  return [
    {
      id: "shop",
      name: "Shop",
      type: "web",
      authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
      environments: [{ name: "local", uiUrl: site.origin, apis: [{ name: "api", baseUrl: `http://127.0.0.1:${downPort}` }] }, { name: "staging" }],
    },
    {
      id: "back-office",
      name: "Back office",
      type: "web",
      authentication: { method: "none" },
      environments: [{ name: "local", uiUrl: `${site.origin}/second`, apis: [{ name: "api", baseUrl: api.origin }] }],
    },
    {
      id: "ledger",
      name: "Ledger",
      type: "api",
      authentication: { method: "none" },
      environments: [{ name: "local", apis: [{ name: "api", baseUrl: site.origin }] }],
    },
  ];
}

/** Runs `use` with the browser tools of the test applications, then closes the browser. */
export async function withTools<T>(
  use: (tool: (name: string) => ToolDefinition, toolset: BrowserToolset) => Promise<T>,
  access: Partial<BrowserAccess> = {},
): Promise<T> {
  const toolset = browserTools(access.launch === undefined ? applications() : applications().slice(0, 1), {
    environment: "local",
    env: ENV,
    screenshotsDir: screenshots,
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

export const page = async (tool: (name: string) => ToolDefinition, app = "shop") => ((await tool(`${app}_snapshot`).execute({})) as { page: string }).page;

export const line = (text: string, element: string) => text.split("\n").find((l) => l.includes(element)) ?? `(no line with ${element})`;

/** Reads `read` again until `done` holds of what it gives, then returns that; the deadline only bounds a test that fails. */
export async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export const reject = (call: Promise<unknown>, message: RegExp) =>
  assert.rejects(call, (failure: unknown) => {
    assert.match(failure instanceof Error ? failure.message : String(failure), message);
    return true;
  });
