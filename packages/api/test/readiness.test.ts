import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Logger } from "@nestjs/common";
import { DatabaseUrl, runMigrations } from "@open-qa-stack/store";
import { PostgresContainer } from "@open-qa-stack/store/testing";
import { closedPort } from "@open-qa-stack/testing";
import { startApi } from "../src/start-api.ts";
import { CapturedLogger } from "./support/captured-logger.ts";
import { childEnvironment } from "./support/environment.ts";

const MAIN = fileURLToPath(new URL("../src/main.js", import.meta.url));
const WITNESS = "witness-9d1e7b42";

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: response.status, body: await response.text() };
}

/** One server for the file: refused passwords first, then stopped and started again. */
let server: PostgresContainer | undefined;
before(async () => {
  server = await PostgresContainer.start();
});
after(() => server?.remove());

function started(): PostgresContainer {
  assert.ok(server !== undefined, "the server of the file did not start");
  return server;
}

const warnings = (logger: CapturedLogger) => logger.lines.filter((line) => line.startsWith("warn "));

const READY = { status: 200, body: '{"status":"ready","checks":{"database":"up"}}' };
const UNREACHABLE = { status: 503, body: '{"status":"not_ready","checks":{"database":"unreachable"}}' };
const ALIVE = { status: 200, body: '{"status":"ok"}' };

describe("an error of connection", () => {
  const leaks = (text: string, url: string) => text.includes(WITNESS) || text.includes(url);

  it("shows neither the password nor the URL when the password is refused", async () => {
    const url = new URL(started().url);
    url.password = WITNESS;
    const port = await closedPort();
    const logger = new CapturedLogger();
    const app = await startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: url.href }, { logger });
    try {
      const readiness = await get(port, "/health/ready");
      assert.deepEqual(readiness, UNREACHABLE);
      assert.ok(!leaks(readiness.body, url.href));
    } finally {
      await app.close();
    }
    const logs = logger.lines.join("\n");
    assert.match(logs, /The database is unreachable: password authentication failed/);
    assert.ok(!leaks(logs, url.href), logs);
  });

  it("shows neither the password nor the URL when nothing listens, in the outputs of the process", async () => {
    const url = `postgres://oqas:${WITNESS}@127.0.0.1:${await closedPort()}/oqas`;
    const env = childEnvironment({ NO_COLOR: "1", OQAS_HOST: "127.0.0.1", OQAS_PORT: String(await closedPort()), OQAS_DATABASE_URL: url });
    const run = await new Promise<{ out: string; err: string }>((resolve) => {
      const child = execFile(process.execPath, ["--enable-source-maps", MAIN], { env, encoding: "utf8" }, (_error, out, err) => resolve({ out, err }));
      child.stdout?.on("data", (chunk: string) => {
        if (chunk.includes("Listening on")) child.kill("SIGTERM");
      });
    });
    assert.match(run.out, /The database is unreachable: .*ECONNREFUSED/);
    assert.ok(!leaks(run.out + run.err, url), run.out + run.err);
  });

  it("shows neither the password nor the URL when the URL is invalid", async () => {
    const url = `postgres://oqas:${WITNESS}@/oqas`;
    const env = childEnvironment({ OQAS_PORT: "8080", OQAS_DATABASE_URL: url });
    const run = await new Promise<{ out: string; err: string }>((resolve) =>
      execFile(process.execPath, [MAIN], { env, encoding: "utf8" }, (_error, out, err) => resolve({ out, err })),
    );
    assert.equal(
      run.err,
      "The configuration is invalid:\n- OQAS_DATABASE_URL must be a database URL: postgres:// or postgresql:// with a host name for a PostgreSQL server, or sqlite: followed by the path of a file.\n",
    );
    assert.ok(!leaks(run.out + run.err, url));
  });
});

describe("the readiness of the instance", () => {
  it("is not ready while the database is stopped, ready once it is started, and the process answers throughout", async () => {
    await runMigrations(DatabaseUrl.parse(started().url) as DatabaseUrl, new Logger("Database"));
    await started().stop();
    const port = await closedPort();
    const logger = new CapturedLogger();
    const app = await startApi({ OQAS_HOST: "127.0.0.1", OQAS_PORT: String(port), OQAS_DATABASE_URL: started().url }, { logger });
    try {
      assert.deepEqual(await get(port, "/health/ready"), UNREACHABLE);
      assert.deepEqual(await get(port, "/health"), ALIVE);
      assert.deepEqual(warnings(logger).filter((line) => line.endsWith(" Database")).length, 1, logger.lines.join("\n"));

      await started().restart();
      assert.deepEqual(await get(port, "/health/ready"), READY);
      assert.deepEqual(await get(port, "/health/ready"), READY);

      await started().stop();
      assert.deepEqual(await get(port, "/health/ready"), UNREACHABLE);
      assert.deepEqual(await get(port, "/health"), ALIVE);
      await started().restart();
      assert.deepEqual(await get(port, "/health/ready"), READY);
    } finally {
      await app.close();
    }
    const logs = logger.lines.join("\n");
    assert.equal(warnings(logger).filter((line) => /^warn The database is unreachable: .*ECONNREFUSED/.test(line)).length, 2, logs);
    assert.equal(logger.lines.filter((line) => line.startsWith("log The database is reachable")).length, 2, logs);
  });
});
