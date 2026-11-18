import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { join } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "vitest";
import type { Session } from "@open-qa-stack/domain/sessions";
import { builtConsole } from "../src/solo/built-console.ts";
import { servedNotice } from "../src/solo/served-console.ts";
import { chain, QUICK, Terminal, WITNESS, workspace, type Ran } from "./support/terminal.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const APPS = fileURLToPath(new URL("../../../apps/", import.meta.url));

const PAGE = "<!doctype html><title>console</title>";

/** A built console as small as one can be, for what only needs one to be served. */
const CONSOLE = join(workspace, "console");
mkdirSync(CONSOLE);
writeFileSync(join(CONSOLE, "index.html"), PAGE);

const ASKED = "The console stops: the session it runs is asked to stop, and ends soon. Ctrl-C again leaves at once, without waiting for it.\n";

let terminal: Terminal;
afterEach(() => terminal.close());

/** A console the command serves on a free port: its address, its end, and the Ctrl-C of the person. */
async function served(...argv: string[]): Promise<{ url: string; ended: Promise<Ran>; interrupt: () => void }> {
  let told: (url: string) => void = () => undefined;
  const url = new Promise<string>((resolve) => (told = resolve));
  let interrupt = (): void => undefined;
  const ended = terminal.oqas(["--ui", "--port", "0", ...argv], {
    printed: (text) => told(text.trim()),
    io: {
      console: CONSOLE,
      onInterrupt: (listener) => {
        interrupt = listener;
        return () => (interrupt = () => assert.fail("the command no longer listens"));
      },
    },
  });
  return { url: await url, ended, interrupt: () => interrupt() };
}

/** Opens a session through the console. */
async function opened(url: string): Promise<Session> {
  const response = await fetch(`${url}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ request: "Test the listing of the orders.", environment: "local" }),
  });
  assert.equal(response.status, 201);
  return (await response.json()) as Session;
}

/** The sessions of the test repository, as another command reads them. */
async function listed(): Promise<(readonly [string, string])[]> {
  const { out } = await terminal.oqas(["sessions", "--output", "json"]);
  return out
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Session)
    .map(({ id, state }) => [id, state] as const);
}

/** Waits until nothing answers at an address any more. */
async function gone(url: string): Promise<void> {
  while (
    await fetch(url).then(
      () => true,
      () => false,
    )
  )
    await pause(QUICK.beatMs);
}

describe("oqas --ui", () => {
  it("serves the console and the operations on the database of the other commands, runs the session opened in it, and stops on Ctrl-C with 0", async () => {
    terminal = await Terminal.open(chain());
    const { url, ended, interrupt } = await served();
    assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
    const page = await fetch(`${url}/`);
    assert.deepEqual([page.status, page.headers.get("content-type"), await page.text()], [200, "text/html; charset=utf-8", PAGE]);
    assert.equal(await (await fetch(`${url}/agent/sessions/session-1`)).text(), PAGE);
    assert.equal((await fetch(`${url}/api/nowhere`)).status, 404);
    const project = (await (await fetch(`${url}/api/project`)).json()) as { applications: unknown[] };
    assert.ok(project.applications.length > 0);

    const { id } = await opened(url);
    let session: Session;
    do {
      await pause(QUICK.beatMs);
      session = (await (await fetch(`${url}/api/sessions/${id}`)).json()) as Session;
    } while (session.state === "queued" || session.state === "running");
    assert.deepEqual([session.state, session.result?.outcome], ["completed", "passed"]);
    assert.deepEqual(await listed(), [[id, "completed"]]);
    const shown = await terminal.oqas(["show", id]);
    assert.match(shown.out, new RegExp(`^Session ${id}: completed, passed, `));

    interrupt();
    assert.deepEqual(await ended, {
      code: 0,
      out: `${url}\n`,
      err: `The console of ${terminal.root} is served at the address below. Ctrl-C stops it.\n${ASKED}`,
    });
    await assert.rejects(fetch(`${url}/`));
  });

  it("asks the session it runs to stop when it is stopped, and leaves it interrupted", async () => {
    terminal = await Terminal.open(chain());
    const door = terminal.designDoor();
    const { url, ended, interrupt } = await served();
    const { id } = await opened(url);
    await door.reached;
    assert.deepEqual(await listed(), [[id, "running"]]);
    interrupt();
    door.open();
    assert.equal((await ended).code, 0);
    assert.deepEqual(await listed(), [[id, "interrupted"]]);
    assert.ok(terminal.server.requests.length < chain().length, "the run stopped instead of going to its end");
  });

  it("leaves at once on a second Ctrl-C, with 5, without waiting for the session it runs", async () => {
    terminal = await Terminal.open(chain());
    const door = terminal.designDoor();
    const { url, ended, interrupt } = await served();
    await opened(url);
    await door.reached;
    interrupt();
    interrupt();
    const left = await ended;
    assert.deepEqual([left.code, left.out], [5, `${url}\n`]);
    door.open();
    await gone(`${url}/`);
  });

  it("warns that the console asks nobody who they are when it listens beyond this machine, and not when it listens on it", () => {
    const served = "The console of /work/tests is served at the address below. Ctrl-C stops it.\n";
    for (const host of ["127.0.0.1", "127.0.0.53", "localhost", "::1"]) assert.equal(servedNotice(host, "/work/tests"), served, host);
    for (const host of ["0.0.0.0", "192.168.1.20", "::", "tests.example"]) {
      assert.equal(
        servedNotice(host, "/work/tests"),
        `The console asks nobody who they are: whoever reaches ${host} opens and stops sessions in /work/tests.\n${served}`,
      );
    }
  });

  it("is refused with 3 when its port is taken, and says how to take another", async () => {
    terminal = await Terminal.open([]);
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as AddressInfo;
    try {
      const { code, out, err } = await terminal.oqas(["--ui", "--port", String(port)], { io: { console: CONSOLE } });
      assert.deepEqual([code, out], [3, ""]);
      assert.ok(
        err.endsWith(`\nThe port ${port} of 127.0.0.1 is taken, by another oqas --ui maybe: give another with --port, or --port 0 for any free one.\n`),
        err,
      );
    } finally {
      taken.close();
    }
  });

  it("stops with 5 when it cannot start for another reason, which it tells: the file of its database cannot be opened", async () => {
    terminal = await Terminal.open([]);
    // A file stands where the folder of the database should be.
    const file = join(CONSOLE, "index.html", "oqas.db");
    const { code, out, err } = await terminal.oqas(["--ui", "--port", "0"], { io: { console: CONSOLE }, env: { OQAS_DATABASE_URL: `sqlite:${file}` } });
    assert.deepEqual([code, out], [5, ""]);
    assert.match(err, /^The database is unreachable: .*oqas\.db cannot be opened \(.+\)\.\n$/);
  });

  it("is refused with 3 when the console is not built, and says what to run", async () => {
    terminal = await Terminal.open([]);
    const empty = join(workspace, "not-built");
    mkdirSync(empty);
    assert.deepEqual(await terminal.oqas(["--ui"], { io: { console: empty } }), {
      code: 3,
      out: "",
      err: `The console is not built: ${empty} holds no index.html. Run pnpm build at the root of the workspace, then oqas --ui again.\n`,
    });
  });
});

describe("the console oqas --ui serves by default", () => {
  it("is the build of the console of the workspace: a page that asks for files named after their content, under assets/", () => {
    const build = builtConsole();
    assert.equal(build, join(APPS, "web", "dist"));
    const page = readFileSync(join(build, "index.html"), "utf8");
    const files = [...page.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)].map((match) => match[1]!);
    assert.ok(
      files.some((file) => /^assets\/[\w.-]+-[\w-]{8}\.js$/.test(file)),
      page,
    );
    assert.ok(
      files.some((file) => /^assets\/[\w.-]+-[\w-]{8}\.css$/.test(file)),
      page,
    );
    for (const file of files) assert.ok(existsSync(join(build, file)), file);
  });
});

describe("oqas --ui, as a program", () => {
  it("serves the built console of the workspace on the port it is given, and exits with 0 on Ctrl-C", async () => {
    terminal = await Terminal.open([]);
    const child = spawn(process.execPath, [MAIN, "--repository", terminal.root, "--ui", "--port", "0"], {
      env: { PATH: process.env["PATH"], SHOP_DB_URL: WITNESS },
    });
    let err = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (err += chunk));
    const [printed] = (await once(child.stdout.setEncoding("utf8"), "data")) as [string];
    const url = printed.trim();
    const page = await fetch(`${url}/`);
    assert.deepEqual([page.status, page.headers.get("cache-control")], [200, "no-cache"]);
    assert.match(await page.text(), /<div id="root"><\/div>/);
    assert.equal((await fetch(`${url}/api/health/ready`)).status, 200);
    const exit = once(child, "exit");
    child.kill("SIGINT");
    assert.deepEqual(await exit, [0, null]);
    assert.equal(err, `The console of ${terminal.root} is served at the address below. Ctrl-C stops it.\n${ASKED}`);
  });
});
