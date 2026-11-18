import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Session, SessionList } from "@open-qa-stack/domain/sessions";
import { closedPort } from "@open-qa-stack/testing";
import { environmentSettings } from "../src/config/environment-settings.ts";
import { startApi } from "../src/index.ts";
import { apiFrom } from "./support/started-api.ts";
import { childEnvironment } from "./support/environment.ts";
import { eventually } from "./support/eventually.ts";

const MAIN = fileURLToPath(new URL("../src/main.js", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));

/** A database nothing listens for: the API starts all the same, not ready. */
async function absentDatabase(): Promise<string> {
  return `postgres://oqas@127.0.0.1:${await closedPort()}/oqas`;
}

describe("an API started with a valid configuration", () => {
  it("listens on the configured port, and its health route answers 200 with the documented body", async () => {
    const port = await closedPort();
    const app = await apiFrom({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: await absentDatabase() });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(response.status, 200);
      assert.match(String(response.headers.get("content-type")), /^application\/json/);
      assert.equal(await response.text(), '{"status":"ok"}');
    } finally {
      await app.close();
    }
  });

  it("listens on any free port when it is given 0, and tells the address it answers at", async () => {
    const read = environmentSettings({ OQAS_HOST: "127.0.0.1", OQAS_PORT: "1", OQAS_DATABASE_URL: await absentDatabase() });
    const api = await startApi({ ...read, port: 0, logger: false });
    try {
      assert.match(api.url, /^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/);
      assert.equal((await fetch(`${api.url}/api/health`)).status, 200);
    } finally {
      await api.close();
    }
  });

  for (const stop of ["SIGTERM", "SIGINT"] as const) {
    it(`logs where it listens, then closes and exits on ${stop}`, async () => {
      const port = await closedPort();
      const env = childEnvironment({ NO_COLOR: "1", OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: await absentDatabase() });
      const child = spawn(process.execPath, ["--enable-source-maps", MAIN], { env });
      let output = "";
      const listening = new Promise<void>((resolve) =>
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes("Listening on")) resolve();
        }),
      );
      const exit = once(child, "exit");
      await listening;
      assert.match(output, new RegExp(`\\[Api\\] Listening on http://127\\.0\\.0\\.1:${port}`));
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/health`)).status, 200);
      child.kill(stop);
      const [code, signal] = await exit;
      assert.deepEqual([code, signal], [null, stop]);
    });
  }
});

describe("an API given a test repository and no database", () => {
  it("keeps its sessions in a file of the state folder of the repository, which it makes, and finds them when it starts again", async () => {
    const repository = mkdtempSync(join(tmpdir(), "oqas-api-startup-"));
    // The configuration of this repository lacks everything a run needs: its session ends at once.
    writeFileSync(join(repository, "oqas.json"), "{}");
    const port = await closedPort();
    const start = () => apiFrom({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_REPOSITORY: repository });
    const sessions = async (): Promise<Session[]> => ((await (await fetch(`http://127.0.0.1:${port}/api/sessions`)).json()) as SessionList).items.slice();
    try {
      const first = await start();
      let ended: Session[];
      try {
        const ready = await fetch(`http://127.0.0.1:${port}/api/health/ready`);
        assert.deepEqual([ready.status, await ready.json()], [200, { status: "ready", checks: { database: "up" } }]);
        const opened = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ request: "cover the profile" }),
        });
        assert.equal(opened.status, 201);
        ended = await eventually(async () => {
          const held = await sessions();
          return held.every((session) => session.state === "interrupted" || session.state === "completed") && held;
        });
        assert.equal(ended.length, 1);
      } finally {
        await first.close();
      }
      assert.ok(existsSync(join(repository, ".oqas", "oqas.db")));
      const second = await start();
      try {
        assert.deepEqual(await sessions(), ended);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  it("starts as a program, and says that its database is up", async () => {
    const repository = mkdtempSync(join(tmpdir(), "oqas-api-startup-"));
    writeFileSync(join(repository, "oqas.json"), "{}");
    const env = childEnvironment({ NO_COLOR: "1", OQAS_HOST: "127.0.0.1", OQAS_PORT: String(await closedPort()), OQAS_REPOSITORY: repository });
    try {
      const run = await new Promise<{ out: string; err: string }>((resolve) => {
        const child = execFile(process.execPath, ["--enable-source-maps", MAIN], { env, encoding: "utf8" }, (_error, out, err) => resolve({ out, err }));
        child.stdout?.on("data", (chunk: string) => {
          if (chunk.includes("Listening on")) child.kill("SIGTERM");
        });
      });
      assert.match(run.out, /\[Database\] The database is reachable and its schema is up to date\./);
      assert.equal(run.err, "");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

describe("an API whose port is taken", () => {
  it("fails to start, and releases what it opened", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as { port: number };
    const database = await absentDatabase();
    try {
      await assert.rejects(apiFrom({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: await absentDatabase() }), {
        code: "EADDRINUSE",
      });
      const run = await new Promise<{ code: number | null; err: string }>((resolve) =>
        execFile(
          process.execPath,
          [MAIN],
          { env: childEnvironment({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: database }), encoding: "utf8" },
          (error, _out, err) => resolve({ code: error === null ? 0 : (error.code as number), err }),
        ),
      );
      assert.equal(run.code, 1);
      assert.match(run.err, /EADDRINUSE/);
    } finally {
      taken.close();
    }
  });
});

describe("the dependency tree of the package", () => {
  it("holds neither express nor the Express adapter of NestJS", async () => {
    const listing = await new Promise<string>((resolve, reject) =>
      execFile("pnpm", ["list", "--depth", "Infinity", "--json"], { cwd: PACKAGE, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (error, out) =>
        error === null ? resolve(out) : reject(error),
      ),
    );
    const names = new Set<string>();
    const walk = (dependencies: Record<string, { dependencies?: Record<string, never> }> = {}): void => {
      for (const [name, dependency] of Object.entries(dependencies)) {
        names.add(name);
        walk(dependency.dependencies);
      }
    };
    for (const project of JSON.parse(listing) as { dependencies?: Record<string, never>; devDependencies?: Record<string, never> }[]) {
      walk(project.dependencies);
      walk(project.devDependencies);
    }
    assert.ok(names.has("@nestjs/platform-fastify") && names.has("fastify"));
    assert.ok(!names.has("express") && !names.has("@nestjs/platform-express"));
  });
});
