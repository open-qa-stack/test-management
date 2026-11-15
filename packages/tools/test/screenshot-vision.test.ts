import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ImageToolResult, type ToolDefinition } from "@open-qa-stack/domain";
import type { Application } from "@open-qa-stack/shared";
import { testSite, type TestSite } from "@open-qa-stack/testing";
import { renderedText, type ShadowTree } from "../src/browser/rendered-text.ts";
import { browserTools } from "../src/index.ts";

const PASSWORD = "demo-password-42";
const ADMIN_PASSWORD = "admin-password-7";
const DATABASE = "postgres://app:s3cret@db/app";
const ENV = { SHOP_USER: "max@example.com", SHOP_PASSWORD: PASSWORD, ADMIN_USER: "root", ADMIN_PASSWORD };
const SECRET_SHOWN = "The page shows a secret of the configuration: its image is not shown.";

let site: TestSite;
let folder: string;

before(async () => {
  site = await testSite({
    "/": '<h1>Policies</h1><div data-testid="box" style="position: absolute; top: 120px; left: 40px; width: 200px; height: 100px; background: #36c"></div>',
    "/login": '<label for="pw">Password</label><input id="pw" type="password"><label for="code">Code</label><input id="code">',
    "/hint": `<p>Demo account: max@example.com, ${PASSWORD}</p>`,
    "/long": '<div style="height: 3000px">Long page</div>',
    "/frame": `<iframe srcdoc="<p>Demo account: ${PASSWORD}</p>"></iframe>`,
    "/frame-field": '<iframe srcdoc="<input type=password value=typed-in-a-frame>"></iframe>',
    "/frame-empty": '<iframe srcdoc="<input type=password>"></iframe>',
    "/shadow": `<div id="card"></div><script>document.getElementById("card").attachShadow({ mode: "open" }).innerHTML = "<p>Demo account: ${PASSWORD}</p>";</script>`,
    "/upper": `<p style="text-transform: uppercase">Demo account: ${PASSWORD}</p>`,
    "/admin": `<p>Root: ${ADMIN_PASSWORD}</p>`,
    "/database": `<p>Connected to ${DATABASE}</p>`,
    // The secret goes as soon as the capture is over, when the cover of the password field leaves the document.
    "/fleeting": `<input type="password"><p id="hint">Demo account: ${PASSWORD}</p><script>new MutationObserver((changes) => { if (changes.some((change) => change.removedNodes.length > 0)) document.getElementById("hint")?.remove(); }).observe(document.documentElement, { childList: true });</script>`,
  });
  folder = mkdtempSync(join(tmpdir(), "oqas-shots-"));
});

after(async () => {
  await site.close();
  rmSync(folder, { recursive: true, force: true });
});

function shop(): Application {
  return {
    id: "shop",
    name: "Shop",
    type: "web",
    authentication: { method: "form", accounts: [{ name: "demo", usernameEnv: "SHOP_USER", passwordEnv: "SHOP_PASSWORD" }] },
    environments: [{ name: "local", uiUrl: site.origin }],
  };
}

/**
 * An application without a user interface in the environment, whose account the shop may still show; the
 * variable of its second account is unset, which withholds no image.
 */
const ADMIN: Application = {
  id: "admin",
  name: "Admin",
  type: "web",
  authentication: {
    method: "form",
    accounts: [
      { name: "root", usernameEnv: "ADMIN_USER", passwordEnv: "ADMIN_PASSWORD" },
      { name: "audit", usernameEnv: "AUDIT_USER", passwordEnv: "AUDIT_PASSWORD" },
    ],
  },
  environments: [{ name: "staging", uiUrl: "http://127.0.0.1:9" }],
};

/** Runs `use` with the browser tools of the shop, the model reading images or not, then closes the browser. */
async function withTools<T>(vision: boolean | undefined, use: (tool: (action: string) => ToolDefinition) => Promise<T>): Promise<T> {
  const options = {
    environment: "local",
    env: ENV,
    screenshotsDir: folder,
    secrets: [DATABASE, PASSWORD, ADMIN_PASSWORD],
    ...(vision === undefined ? {} : { vision }),
  };
  const toolset = browserTools([shop(), ADMIN], options);
  try {
    return await use((action) => toolset.tools.find((t) => t.name === `shop_${action}`)!);
  } finally {
    await toolset.close();
  }
}

const shot = async (tool: (action: string) => ToolDefinition, args: unknown = {}) => (await tool("screenshot").execute(args)) as ImageToolResult;

describe("criterion 1 — without vision, the screenshot tool returns its path alone, as before", () => {
  it("offers the same tool, and gives no image", async () => {
    for (const vision of [undefined, false]) {
      await withTools(vision, async (tool) => {
        const screenshot = tool("screenshot");
        assert.equal(screenshot.description, `Saves a screenshot of the page of Shop (local) and returns where it is.`);
        assert.deepEqual(Object.keys(screenshot.parameters["properties"] as object), ["fullPage"]);
        const result = await screenshot.execute({});
        assert.ok(!(result instanceof ImageToolResult));
        assert.deepEqual(Object.keys(result as object), ["path"]);
        assert.ok(existsSync((result as { path: string }).path));
      });
    }
  });
});

describe("criterion 2 — with vision, the screenshot tool gives the image, never reduced", () => {
  it("gives the image of the viewport at the 1280 pixels of its width, as it writes it", async () => {
    await withTools(true, async (tool) => {
      const result = await shot(tool);
      assert.ok(result instanceof ImageToolResult);
      assert.deepEqual(result.size, { width: 1280, height: 720 });
      assert.deepEqual(Object.keys(result.value), ["path"]);
      assert.deepEqual(Buffer.from(result.png), readFileSync(result.value["path"] as string));
    });
  });

  it("gives the whole page when asked, at the same width", async () => {
    await withTools(true, async (tool) => {
      await tool("goto").execute({ url: "/long" });
      const { size } = await shot(tool, { fullPage: true });
      assert.equal(size.width, 1280);
      assert.ok(size.height > 3000);
    });
  });

  it("crops to one element at the scale of the page, rather than reducing", async () => {
    await withTools(true, async (tool) => {
      assert.deepEqual((await shot(tool, { within: { testId: "box" } })).size, { width: 200, height: 100 });
      await assert.rejects(tool("screenshot").execute({ within: { testId: "missing" } }), /^Error: page\.getByTestId\("missing"\) matches no element\./);
    });
  });

  it("tells the model what the image is for, and that it may not ask for the whole page and an element at once", async () => {
    await withTools(true, async (tool) => {
      const screenshot = tool("screenshot");
      assert.match(screenshot.description, /never reduced/);
      assert.match(screenshot.description, /button without a name/);
      assert.match(screenshot.description, /base no assertion on the image alone/);
      assert.deepEqual(screenshot.parameters["not"], { required: ["fullPage", "within"] });
    });
  });
});

describe("criterion 3 — no image of a page that shows a secret goes to the model, and password fields are covered", () => {
  it("gives the path alone, and why, for a page whose text shows a secret the session declares", async () => {
    await withTools(true, async (tool) => {
      await tool("goto").execute({ url: "/hint" });
      const result = await tool("screenshot").execute({});
      assert.ok(!(result instanceof ImageToolResult));
      assert.deepEqual(result, { path: join(folder, "shop-1.png"), imageNotShown: SECRET_SHOWN });
      assert.ok(existsSync(join(folder, "shop-1.png")));
    });
  });

  for (const [page, where] of [
    ["/frame", "in a frame"],
    ["/shadow", "in a shadow root"],
    ["/upper", "in capitals, by its style"],
    ["/admin", "the session declares for another application"],
    ["/database", "that is a connection string"],
    ["/fleeting", "until the capture is over"],
  ] as const) {
    it(`gives the path alone for a page that shows the secret ${where}`, async () => {
      await withTools(true, async (tool) => {
        await tool("goto").execute({ url: page });
        assert.equal(((await tool("screenshot").execute({})) as { imageNotShown?: string }).imageNotShown, SECRET_SHOWN);
      });
    });
  }

  it("gives the path alone for a page whose text field shows the secret", async () => {
    await withTools(true, async (tool) => {
      await tool("goto").execute({ url: "/login" });
      await tool("fill").execute({ target: { label: "Code" }, value: { account: "demo", field: "password" } });
      assert.equal(((await tool("screenshot").execute({})) as { imageNotShown?: string }).imageNotShown, SECRET_SHOWN);
    });
  });

  it("gives the image of a page whose password field holds the password, the field covered", async () => {
    const filled = async (vision: boolean, fill: boolean) =>
      withTools(vision, async (tool) => {
        await tool("goto").execute({ url: "/login" });
        // Both fields are focused alike, so that only what the field holds tells the images apart.
        await tool("fill").execute({ target: { label: "Password" }, value: fill ? { account: "demo", field: "password" } : "" });
        const result = await tool("screenshot").execute({});
        if (!vision) return readFileSync((result as { path: string }).path);
        assert.ok(result instanceof ImageToolResult, "the image of the page is given");
        return Buffer.from(result.png);
      });
    const [covered, empty] = [await filled(true, true), await filled(true, false)];
    assert.deepEqual(covered, empty, "the image does not change with what the password field holds");
    assert.notDeepEqual(await filled(false, true), await filled(false, false), "without the cover, the field shows what it holds");
  });

  it("covers the password fields of the frames of the page too", async () => {
    const image = async (url: string) =>
      withTools(true, async (tool) => {
        await tool("goto").execute({ url });
        return Buffer.from((await shot(tool)).png);
      });
    assert.deepEqual(await image("/frame-field"), await image("/frame-empty"));
  });
});

describe("the text a page shows", () => {
  it("reads the body, then each open shadow root, those inside a shadow root included", () => {
    const tree = (textContent: string, hosts: (ShadowTree | null)[] = []): ShadowTree => ({
      textContent,
      querySelectorAll: () => hosts.map((shadowRoot) => ({ shadowRoot })),
    });
    const hosts = [null, tree("Card", [tree("Badge")]), tree("Menu")];
    const root = (body: { innerText: string } | null) => ({ ownerDocument: { body }, querySelectorAll: () => hosts.map((shadowRoot) => ({ shadowRoot })) });
    assert.equal(renderedText(root({ innerText: "Policies" })), "Policies\nCard\nBadge\nMenu");
    assert.equal(renderedText(root(null)), "\nCard\nBadge\nMenu");
  });
});
