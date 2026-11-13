import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { closedPort } from "@open-qa-stack/testing";
import { startApi } from "../src/start-api.ts";
import { childEnvironment } from "./support/environment.ts";

const MAIN = fileURLToPath(new URL("../src/main.js", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../..", import.meta.url));

/** A database nothing listens for: the API starts all the same, not ready. */
async function absentDatabase(): Promise<string> {
  return `postgres://oqas@127.0.0.1:${await closedPort()}/oqas`;
}

describe("an API started with a valid configuration", () => {
  it("listens on the configured port, and its health route answers 200 with the documented body", async () => {
    const port = await closedPort();
    const app = await startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: await absentDatabase() }, { logger: false });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(response.status, 200);
      assert.match(String(response.headers.get("content-type")), /^application\/json/);
      assert.equal(await response.text(), '{"status":"ok"}');
    } finally {
      await app.close();
    }
  });

  it("runs on an underlying Fastify instance", async () => {
    const port = await closedPort();
    const app = await startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: await absentDatabase() }, { logger: false });
    try {
      const adapter = app.getHttpAdapter();
      assert.ok(adapter instanceof FastifyAdapter);
      assert.equal(adapter.getType(), "fastify");
      const instance = adapter.getInstance();
      assert.equal(typeof instance.inject, "function");
      assert.equal(instance.server, app.getHttpServer());
    } finally {
      await app.close();
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
      assert.match(output, new RegExp(`\\[Api\\] Listening on 127\\.0\\.0\\.1:${port}`));
      assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200);
      child.kill(stop);
      const [code, signal] = await exit;
      assert.deepEqual([code, signal], [null, stop]);
    });
  }
});

describe("an API whose port is taken", () => {
  it("fails to start, and releases what it opened", async () => {
    const taken = createServer();
    await new Promise<void>((resolve) => taken.listen(0, "127.0.0.1", resolve));
    const { port } = taken.address() as { port: number };
    const database = await absentDatabase();
    try {
      await assert.rejects(startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: await absentDatabase() }, { logger: false }), { code: "EADDRINUSE" });
      const run = await new Promise<{ code: number | null; err: string }>((resolve) =>
        execFile(process.execPath, [MAIN], { env: childEnvironment({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: database }), encoding: "utf8" }, (error, _out, err) =>
          resolve({ code: error === null ? 0 : (error.code as number), err }),
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
