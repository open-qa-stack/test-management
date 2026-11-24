import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { ApiConfiguration } from "../src/config/api-configuration.ts";
import { builtConsole } from "../src/config/value-type.ts";
import { sessionsApi, type TestApi } from "./support/sessions-api.ts";

const PAGE = '<!doctype html><title>console</title><script type="module" src="/assets/index-B7x2Qk9a.js"></script>';
const SCRIPT = 'document.title = "console";';
const SECRET = "the key of the model";

const HTML = "text/html; charset=utf-8";
const SCRIPT_TYPE = "application/javascript; charset=utf-8";
const PROBLEM = "application/problem+json; charset=utf-8";
const REVALIDATED = "no-cache";
const KEPT = "public, max-age=31536000, immutable";

/** A folder that holds a built console, small, beside a file no address may reach. */
const workspace = mkdtempSync(join(tmpdir(), "oqas-api-console-"));
const folder = join(workspace, "console");
mkdirSync(join(folder, "assets"), { recursive: true });
writeFileSync(join(workspace, "secret.txt"), SECRET);
writeFileSync(join(folder, "index.html"), PAGE);
writeFileSync(join(folder, ".env"), SECRET);
writeFileSync(join(folder, "favicon.svg"), "<svg/>");
writeFileSync(join(folder, "assets", "index-B7x2Qk9a.js"), SCRIPT);
writeFileSync(join(folder, "assets", "index-Dq3lmn0P.css"), "body{}");
after(() => rmSync(workspace, { recursive: true, force: true }));

describe("the built console an API is given", () => {
  it("is named by the absolute path of the folder that holds its page, and may be left unset: the API then has none", () => {
    assert.deepEqual(builtConsole.parse(folder), { ok: true, value: folder });
    assert.deepEqual(builtConsole.parse(workspace), { ok: false });
    assert.deepEqual(builtConsole.parse("console"), { ok: false });
    const read = (variables: Record<string, string>) => ApiConfiguration.read({ OQAS_PORT: "8080", OQAS_DATABASE_URL: "sqlite:/srv/oqas.db", ...variables });
    assert.deepEqual([read({ OQAS_CONSOLE: folder }).console, read({}).console], [folder, undefined]);
    assert.throws(() => read({ OQAS_CONSOLE: workspace }), { violations: ["OQAS_CONSOLE must be the absolute path of a folder that holds index.html."] });
  });
});

/** What a test compares of an answer: its status, its media type, how long it may be kept, and its text. */
async function answered(response: Response): Promise<readonly [number, string | null, string | null, string]> {
  return [response.status, response.headers.get("content-type"), response.headers.get("cache-control"), await response.text()];
}

/** Asks for a path exactly as written, with the headers given and no other: `fetch` would tidy the first, and add to the second. */
function raw(origin: string, path: string, headers: Record<string, string> = {}): Promise<readonly [number | undefined, string]> {
  return new Promise((resolve, reject) => {
    const asked = request(`${origin}/`, { path, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => resolve([response.statusCode, body]));
    });
    asked.on("error", reject);
    asked.end();
  });
}

describe("an API given a built console", () => {
  const project = { name: "shop-tests", applications: [] };
  let api: TestApi;
  before(async () => {
    api = await sessionsApi({ console: folder, operations: { project: async () => project } });
  });
  after(() => api.close());

  it("serves its page at the root of its address and at a route of the console, asked again at each visit, its routes staying under /api", async () => {
    for (const path of ["/", "/index.html", "/?show=talk", "/agent/sessions/session-1?show=talk", "/assets"]) {
      assert.deepEqual(await answered(await fetch(`${api.origin}${path}`)), [200, HTML, REVALIDATED, PAGE], path);
    }
    const served = await fetch(`${api.url}/project`);
    assert.deepEqual([served.status, await served.json()], [200, project]);
  });

  it("serves a file under the type of its extension whatever its bytes look like, a hashed one to keep for good", async () => {
    const script = await fetch(`${api.origin}/assets/index-B7x2Qk9a.js`);
    assert.equal(script.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(await answered(script), [200, SCRIPT_TYPE, KEPT, SCRIPT]);
    assert.deepEqual(await answered(await fetch(`${api.origin}/assets/index-Dq3lmn0P.css?v=2`)), [200, "text/css; charset=utf-8", KEPT, "body{}"]);
    assert.deepEqual(await answered(await fetch(`${api.origin}/favicon.svg`)), [200, "image/svg+xml", REVALIDATED, "<svg/>"]);
  });

  it("answers the head of a file as the file, without its body, and a file a browser already has without sending it again", async () => {
    const head = await fetch(`${api.origin}/`, { method: "HEAD" });
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(PAGE)));
    assert.deepEqual(await answered(head), [200, HTML, REVALIDATED, ""]);
    const etag = String(head.headers.get("etag"));
    assert.deepEqual(await raw(api.origin, "/", { "if-none-match": etag }), [304, ""]);
  });

  it("answers a problem, never the page, under the routes of the API, for a file that is missing and for another method", async () => {
    for (const path of ["/api/nowhere", "/api", "/api/", "/api?show=talk", "/assets/index-00000000.js", "/missing.png", "/agent/app.js"]) {
      const [status, type, , body] = await answered(await fetch(`${api.origin}${path}`));
      assert.deepEqual([status, type], [404, PROBLEM], path);
      assert.deepEqual((JSON.parse(body) as { detail: string }).detail, `Cannot GET ${path}`);
    }
    const posted = await fetch(`${api.origin}/`, { method: "POST" });
    assert.deepEqual([posted.status, posted.headers.get("content-type")], [404, PROBLEM]);
  });

  it("serves beside it the trace viewer of Playwright, as playwright-core builds it, asked again at each visit", async () => {
    const page = await fetch(`${api.origin}/trace-viewer/index.html?trace=%2Fapi%2Ftests%2Ftrace`);
    const [status, type, cache, body] = await answered(page);
    assert.deepEqual([status, type, cache, page.headers.get("x-content-type-options")], [200, HTML, REVALIDATED, "nosniff"]);
    assert.match(body, /<title>Playwright Trace Viewer<\/title>/);
    const worker = await fetch(`${api.origin}/trace-viewer/sw.bundle.js`);
    assert.deepEqual([worker.status, worker.headers.get("content-type")], [200, SCRIPT_TYPE]);
    const missing = await fetch(`${api.origin}/trace-viewer/missing.js`);
    assert.deepEqual([missing.status, missing.headers.get("content-type")], [404, PROBLEM]);
  });

  it("serves nothing out of its folder nor a hidden file of it, however the path is written", async () => {
    const paths = [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/%2E%2E%2Fsecret.txt",
      "/assets/..%2F..%2Fsecret.txt",
      "/assets/../../secret.txt",
      "/assets%5C..%5C..%5Csecret.txt",
      "//secret.txt",
      "/.env",
      "/%2eenv",
      "/index.html%00.txt",
      "/trace-viewer/../secret.txt",
      "/trace-viewer/%2e%2e/%2e%2e/package.json",
    ];
    for (const path of paths) {
      const [status, body] = await raw(api.origin, path);
      assert.ok(status === 404 || status === 400 || body === PAGE, `${path}: ${status}`);
      assert.ok(!body.includes(SECRET), path);
    }
  });
});

describe("an API given no console", () => {
  it("serves its routes alone: its root and the trace viewer are routes that do not exist", async () => {
    const api = await sessionsApi({ operations: {} });
    try {
      for (const path of ["/", "/trace-viewer/index.html"]) {
        const answer = await fetch(`${api.origin}${path}`);
        assert.deepEqual([path, answer.status, answer.headers.get("content-type")], [path, 404, PROBLEM]);
      }
    } finally {
      await api.close();
    }
  });
});
