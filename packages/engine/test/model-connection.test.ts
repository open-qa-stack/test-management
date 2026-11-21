import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateConfig, type ModelConnectionCheck } from "@open-qa-stack/domain";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, it } from "vitest";
import { liveRuntime, ModelConnection } from "../src/index.ts";
import { missingPrerequisites } from "../src/run/prerequisites.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-engine-model-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The probes of a test, which tell what they were asked. */
function played(): { asked: unknown[][]; connection: ModelConnection } {
  const asked: unknown[][] = [];
  const found: ModelConnectionCheck = { state: "connected" };
  const connection = new ModelConnection(
    { OPENAI_API_KEY: "sk-test", EMPTY: "" },
    {
      github: (env) => {
        asked.push(["github", env["OPENAI_API_KEY"]]);
        return Promise.resolve(found);
      },
      provider: (baseUrl, key) => {
        asked.push(["provider", baseUrl, key]);
        return Promise.resolve(found);
      },
    },
  );
  return { asked, connection };
}

describe("the test of the connection to the model", () => {
  it("asks the GitHub account of the machine for a model of Copilot, with the environment of the process", async () => {
    const { asked, connection } = played();
    assert.deepEqual(await connection.check({ mode: "github", model: "" }), { state: "connected" });
    assert.deepEqual(asked, [["github", "sk-test"]]);
  });

  it("asks the server with the key the variable holds, or with none when the configuration names none", async () => {
    const { asked, connection } = played();
    await connection.check({ mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "", apiKeyEnv: "OPENAI_API_KEY" });
    await connection.check({ mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "" });
    assert.deepEqual(asked, [
      ["provider", "https://api.openai.com/v1", "sk-test"],
      ["provider", "http://localhost:1234/v1", undefined],
    ]);
  });

  it("says the variable of the key is not set without asking the server, whether it is absent or empty", async () => {
    const { asked, connection } = played();
    for (const variable of ["MISSING", "EMPTY"])
      assert.deepEqual(await connection.check({ mode: "provider-key", provider: "openai", baseUrl: "https://x/v1", model: "", apiKeyEnv: variable }), {
        state: "key-missing",
        variable,
      });
    assert.deepEqual(asked, []);
  });

  it("checks with the harness when given no probes of its own", async () => {
    const check = await new ModelConnection({}).check({ mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "" });
    assert.deepEqual(check, { state: "unreachable", url: "http://127.0.0.1:9/v1" });
  });
});

/** A configuration whose model is one of GitHub Copilot. */
function githubConfig(effort: object = { reasoningEffort: "low" }) {
  const result = validateConfig(
    JSON.stringify({
      formatVersion: 1,
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [{ name: "local", apis: [{ name: "b", baseUrl: "http://127.0.0.1:1" }] }],
        },
      ],
      knowledge: [],
      model: { mode: "github", model: "gpt-5", capabilities: ["vision"], ...effort },
    }),
    {},
  );
  assert.ok(result.ok, JSON.stringify(result));
  return result.config;
}

describe("the model server a run needs", () => {
  /** A model server that refuses every key, and the configuration of a server at its address, with the variable of its key when one is named. */
  async function refusing(apiKeyEnv?: string) {
    const server = createServer((_request, response) => response.writeHead(401).end("{}"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
    const result = validateConfig(
      JSON.stringify({
        formatVersion: 1,
        applications: [
          {
            id: "shop",
            name: "Shop",
            type: "api",
            authentication: { method: "none" },
            environments: [{ name: "local", apis: [{ name: "b", baseUrl: "http://127.0.0.1:1" }] }],
          },
        ],
        knowledge: [],
        model: { mode: "provider-key", provider: "openai", baseUrl, model: "m", ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }) },
      }),
      { MODEL_KEY: "sk-wrong" },
    );
    assert.ok(result.ok, JSON.stringify(result));
    return { baseUrl, config: result.config, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
  }
  const npm = { run: () => Promise.resolve({ exitCode: 0, stdout: "11.0.0\n", stderr: "" }) };

  it("is missing when it refuses the key: the run stops before any session, naming the variable and never the key", async () => {
    const keyed = await refusing("MODEL_KEY");
    try {
      const missing = await missingPrerequisites(keyed.config, workspace, npm, { MODEL_KEY: "sk-wrong" });
      const problem = missing.find((one) => one.startsWith("The model server"));
      assert.equal(problem, `The model server at ${keyed.baseUrl} refused the key in MODEL_KEY, with status 401: check the key; oqas model status tests it.`);
      assert.ok(!missing.join(" ").includes("sk-wrong"));
    } finally {
      await keyed.close();
    }
    const keyless = await refusing();
    try {
      const missing = await missingPrerequisites(keyless.config, workspace, npm, {});
      assert.ok(
        missing.includes(`The model server at ${keyless.baseUrl} asks for a key, with status 401: name the variable that holds it with oqas model set.`),
      );
    } finally {
      await keyless.close();
    }
  });
});

describe("a run on a model of GitHub Copilot", () => {
  it("asks no server whether it answers: the session that calls the model tells", async () => {
    const missing = await missingPrerequisites(githubConfig(), workspace, { run: () => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" }) }, {});
    assert.ok(!missing.some((problem) => problem.includes("model server")), missing.join(" "));
  });

  it("opens its runtime with no gateway, and closes it without having started it", async () => {
    for (const config of [githubConfig(), githubConfig({})]) {
      const open = await liveRuntime(config, {});
      await open.close();
    }
  });
});
