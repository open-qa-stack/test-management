import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { EventEmitter } from "node:events";
import net from "node:net";
import { type Page } from "playwright-core";
import { LOG_CAPACITY } from "../src/browser/application-page.ts";
import { PageLog } from "../src/browser/page-log.ts";
import { redact, SECRET_MASK, secretForms } from "../src/browser/redact.ts";
import { MAX_TEXT_LENGTH, shortText } from "../src/browser/short-text.ts";
import { NetworkAccessError } from "@open-qa-stack/testing";
import { PASSWORD, site, screenshots, downPort, withTools, page, eventually, reject } from "./browser-tools-support.ts";

describe("calls made at once on one page", () => {
  it("run one after the other, in order, so that none interrupts another", async () => {
    await withTools(async (tool) => {
      const results = await Promise.all([
        tool("shop_goto").execute({ url: "/second" }),
        tool("shop_goto").execute({ url: "/" }),
        tool("shop_snapshot").execute({}),
      ]);
      assert.deepEqual(results.slice(0, 2), [
        { url: `${site.origin}/second`, title: "/second", code: 'await page.goto("/second");' },
        { url: `${site.origin}/`, title: "/", code: 'await page.goto("/");' },
      ]);
      assert.match((results[2] as { page: string }).page, /heading "My Policies"/);
      const [failed, next] = await Promise.allSettled([
        tool("shop_click").execute({ target: { role: "button", name: "Missing" } }),
        tool("shop_snapshot").execute({}),
      ]);
      assert.deepEqual([failed.status, next.status], ["rejected", "fulfilled"]);
    });
  });
});

describe("criterion 5 — the agent reads the requests and the console of the page", () => {
  it("lists the document and the API calls, and the assets when asked", async () => {
    await withTools(async (tool) => {
      await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } });
      await tool("shop_wait_for").execute({ target: { text: "Card" } });
      const calls = async (args: object) =>
        (await tool("shop_network").execute(args)) as { method: string; url: string; resourceType: string; status?: number }[];
      await eventually(
        () => calls({ assets: true }),
        (all) => all.some((c) => c.resourceType === "fetch") && all.every((c) => !("pending" in c)),
      );
      assert.deepEqual(await calls({}), [
        { method: "GET", url: `${site.origin}/`, resourceType: "document", status: 200 },
        { method: "GET", url: `${site.origin}/api/ping`, resourceType: "fetch", status: 200 },
      ]);
      assert.deepEqual(
        (await calls({ limit: 1 })).map((c) => c.url),
        [`${site.origin}/api/ping`],
      );
      assert.deepEqual(
        (await calls({ assets: true })).filter((c) => c.resourceType === "image").map((c) => [c.url, c.status]),
        [[`${site.origin}/api/ping`, 200]],
      );
    });
  });

  it("shows a failed request even when it is an asset", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/broken" });
      const failed = ((await tool("shop_network").execute({})) as { url: string; resourceType: string; failure?: string }[]).filter(
        (entry) => entry.failure !== undefined,
      );
      assert.deepEqual(
        failed.map((entry) => [entry.url, entry.resourceType]),
        [[`http://127.0.0.1:${downPort}/logo.png`, "image"]],
      );
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
    assert.deepEqual(
      log.network(10, false).map((e) => [new URL(e.url).pathname, e.status ?? e.failure ?? "pending"]),
      [
        ["/b", "pending"],
        ["/c", "net::ERR_FAILED"],
      ],
    );
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
      assert.deepEqual(
        await eventually(
          () => tool("shop_console").execute({}) as Promise<unknown[]>,
          (lines) => lines.length === 3,
        ),
        [
          { type: "log", text: "signed in" },
          { type: "error", text: "boom" },
          { type: "pageerror", text: "kaput" },
        ],
      );
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

describe("test accounts — the agent types them by name, and a test reads them from their variables", () => {
  it("types a declared account by its name, and gives the line of code that reads it from its variable", async () => {
    await withTools(async (tool) => {
      const typed = [
        await tool("shop_fill").execute({ target: { label: "Email" }, value: { account: "demo", field: "username" } }),
        await tool("shop_fill").execute({ target: { role: "textbox", name: "Password" }, value: { account: "demo", field: "password" } }),
      ];
      assert.deepEqual(
        typed.map((result) => (result as { code: string }).code),
        [
          'await page.getByLabel("Email", { exact: true }).fill(process.env.SHOP_USER!);',
          'await page.getByRole("textbox", { name: "Password", exact: true }).fill(process.env.SHOP_PASSWORD!);',
        ],
      );
      // Nothing of a test account is masked: a test environment shows it.
      await tool("shop_click").execute({ target: { role: "button", name: "Sign in" } });
      assert.match(await page(tool), new RegExp(`Hello max@example\\.com ${PASSWORD}`));
    });
  });

  it("refuses an unknown account, or one whose variable is not set", async () => {
    await withTools(async (tool) => {
      await reject(
        tool("shop_fill").execute({ target: { label: "Email" }, value: { account: "root", field: "username" } }),
        /^shop has no test account named root; accounts: demo\.$/,
      );
    });
    await withTools(
      async (tool) => {
        await reject(
          tool("shop_fill").execute({ target: { label: "Email" }, value: { account: "demo", field: "password" } }),
          /^Environment variable SHOP_PASSWORD is not set\.$/,
        );
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

describe("a page that loads its data", () => {
  it("is read with what it asked another local service, once it is opened and once it is acted on", async () => {
    await withTools(async (tool) => {
      await tool("shop_goto").execute({ url: "/loads" });
      assert.match(await page(tool), /pong true/);
      await tool("shop_click").execute({ target: { role: "button", name: "More" } });
      assert.match(await page(tool), /More data/);
    });
  });

  it("is read as it is once the settling time is over, when a request is still open", async () => {
    await withTools(
      async (tool) => {
        // The request is never answered: the page is given back all the same, whatever the speed of the machine.
        await tool("shop_goto").execute({ url: "/hangs" });
        assert.match(await page(tool), /waiting/);
      },
      { settleTimeoutMs: 400 },
    );
  });
});
