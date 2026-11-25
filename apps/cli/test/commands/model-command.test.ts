import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import type { Model, ModelConnectionCheck, OqasConfig } from "@open-qa-stack/domain";
import type { ConnectionProbes } from "@open-qa-stack/engine";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { runOqas } from "../../src/index.ts";
import { keptTuning } from "../../src/output/model-lines.ts";
import { FakeTerminal } from "../support/fake-terminal.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-model-command-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The configuration of the test repositories, as their file first holds it: a model served on the machine. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/");

/** The models a played connection offers. */
const MODELS = [
  { id: "gpt-5", name: "GPT-5", vision: true, reasoningEfforts: ["low", "high"] },
  { id: "mini", name: "mini", reasoningEfforts: [] },
];

/** A test repository with its database beside it, the connections the test plays, and how to run oqas in it. */
function repository(answers: { github?: ModelConnectionCheck; provider?: ModelConnectionCheck } = {}, played = true, terminal?: FakeTerminal) {
  const root = mkdtempSync(join(workspace, "repo-"));
  writeFileSync(join(root, "oqas.json"), TEXT);
  const asked: unknown[][] = [];
  const probes: ConnectionProbes = {
    github: () => {
      asked.push(["github"]);
      return Promise.resolve(answers.github ?? { state: "signed-out" });
    },
    provider: (baseUrl, key) => {
      asked.push(["provider", baseUrl, key]);
      return Promise.resolve(answers.provider ?? { state: "unreachable", url: baseUrl });
    },
  };
  const env = { OQAS_DATABASE_URL: `sqlite:${join(workspace, `${root.split("/").at(-1)!}.db`)}`, OPENAI_API_KEY: "sk-test" };
  const oqas = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runOqas(argv, {
      env,
      cwd: root,
      ...(played ? { probes } : {}),
      ...(terminal === undefined ? {} : { terminal }),
      stdout: { write: (text: string) => (out += text) },
      stderr: { write: (text: string) => (err += text) },
    });
    return { code, out, err };
  };
  // The model in force, as the instance keeps it: no command rewrites oqas.json.
  const model = async () =>
    (JSON.parse((await oqas("config", "show", "--output", "json")).out) as { revision: { document: OqasConfig } }).revision.document.model;
  const saved = () => JSON.parse(readFileSync(join(root, ".oqas", "secrets", "values.json"), "utf8")) as Record<string, string>;
  return { oqas, asked, model, saved };
}

describe("oqas model status", () => {
  it("tests the model in force, tells what to do when it does not answer, and exits with 4", async () => {
    const { oqas, asked } = repository();
    const told = await oqas("model", "status");
    assert.equal(told.code, 4);
    assert.equal(told.out, "http://127.0.0.1:9/v1, model test-model.\nNothing answers at http://127.0.0.1:9/v1: check the address, or that the server runs.\n");
    assert.deepEqual(asked, [["provider", "http://127.0.0.1:9/v1", undefined]]);
  });

  it("tests the server itself when given no connection to play", async () => {
    const told = await repository({}, false).oqas("model", "status");
    assert.deepEqual([told.code, told.out.split("\n")[1]], [4, "Nothing answers at http://127.0.0.1:9/v1: check the address, or that the server runs."]);
  });

  it("lists the models offered, says the one in force is among them, and exits with 0; prints it all as JSON when asked", async () => {
    const { oqas } = repository({ provider: { state: "connected", models: [{ id: "test-model", name: "test-model", reasoningEfforts: [] }, ...MODELS] } });
    const told = await oqas("model", "status");
    assert.equal(told.code, 0);
    assert.equal(
      told.out,
      "http://127.0.0.1:9/v1, model test-model.\nThe model answers.\n3 models are offered:\n  test-model\n  gpt-5 — GPT-5\n  mini\ntest-model is among them.\n",
    );
    const json = JSON.parse((await oqas("model", "status", "--output", "json")).out) as { offered: boolean; check: { state: string } };
    assert.deepEqual([json.offered, json.check.state], [true, "connected"]);
  });

  it("says when the model in force is not offered, and exits with 4; and when the server lists none, and exits with 0", async () => {
    const absent = await repository({ provider: { state: "connected", models: MODELS.slice(1) } }).oqas("model", "status");
    assert.equal(absent.code, 4);
    assert.match(absent.out, /1 model is offered:\n {2}mini\ntest-model is not among them: set one of them with oqas model set\.\n$/);
    const unlisted = await repository({ provider: { state: "connected" } }).oqas("model", "status");
    assert.equal(unlisted.code, 0);
    assert.match(unlisted.out, /The model answers\.\nThe server does not list its models\.\n$/);
  });
});

describe("oqas model set", () => {
  it("sets the GitHub account of the machine, saves it as the revision in force, and tests it", async () => {
    const { oqas, asked, model } = repository({ github: { state: "connected", account: "octo", models: MODELS } });
    const told = await oqas("model", "set", "--github", "--model", "gpt-5");
    assert.equal(told.code, 0);
    assert.match(
      told.out,
      /^The GitHub account of this machine \(GitHub Copilot\), model gpt-5\.\nThe model answers, through the GitHub account octo\.\n2 models are offered:/,
    );
    assert.deepEqual(await model(), { mode: "github", model: "gpt-5" });
    assert.deepEqual(asked, [["github"]]);
    const config = await oqas("config", "show");
    assert.match(config.out, /^Revision 2 of the configuration, saved by a command on /);
  });

  it("sets a provider by its name, with its address and the variable of its key, and reads the key from it", async () => {
    const { oqas, asked, model } = repository({ provider: { state: "key-refused", status: 401 } });
    const told = await oqas("model", "set", "--provider", "openai", "--model", "gpt-4.1");
    assert.equal(told.code, 4);
    assert.equal(
      told.out,
      "OpenAI, its key in OPENAI_API_KEY, model gpt-4.1.\nThe server refused the key, with status 401: check the key the variable holds.\n",
    );
    assert.deepEqual(await model(), {
      mode: "provider-key",
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      apiKeyEnv: "OPENAI_API_KEY",
    });
    assert.deepEqual(asked, [["provider", "https://api.openai.com/v1", "sk-test"]]);
  });

  it("sets a provider by its address too, another server with the variable named, and tells the other failures", async () => {
    const byAddress = repository();
    await byAddress.oqas("model", "set", "--provider", "https://api.mistral.ai/v1/", "--key-env", "MINE", "--model", "m");
    assert.deepEqual(await byAddress.model(), {
      mode: "provider-key",
      provider: "openai",
      baseUrl: "https://api.mistral.ai/v1",
      model: "m",
      apiKeyEnv: "MINE",
    });
    const other = repository({ provider: { state: "key-missing", variable: "LOCAL_KEY" } });
    const told = await other.oqas("model", "set", "--provider", "http://localhost:1234/v1", "--key-env", "LOCAL_KEY", "--model", "qwen");
    assert.equal(
      told.out,
      "http://localhost:1234/v1, its key in LOCAL_KEY, model qwen.\nLOCAL_KEY holds no key: give it with oqas secrets set LOCAL_KEY, or set the variable, then run oqas model status again.\n",
    );
    const bare = repository();
    await bare.oqas("model", "set", "--provider", "http://localhost:1234/v1", "--model", "qwen");
    assert.deepEqual(await bare.model(), { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "qwen" });
  });

  it("tells a GitHub account signed out or without models what to do", async () => {
    const out = await repository().oqas("model", "set", "--github", "--model", "gpt-5");
    assert.match(out.out, /\nNo GitHub account is signed in on this machine: run gh auth login, then oqas model status\.\n$/);
    const none = await repository({ github: { state: "no-models", account: "octo" } }).oqas("model", "set", "--github", "--model", "gpt-5");
    assert.match(none.out, /\nThe GitHub account octo is signed in, but GitHub Copilot offers it no model/);
  });

  it("keeps the tuning of the model in force when it is set again the same way, and drops it for another", async () => {
    const { oqas, model } = repository();
    await oqas("model", "set", "--provider", "http://127.0.0.1:9/v1", "--model", "test-model");
    assert.deepEqual(await model(), { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" });
    const local: Model = { mode: "provider-key", provider: "openai", baseUrl: "http://x/v1", model: "m" };
    const tuned: Model = { ...local, capabilities: ["vision"], reasoningEffort: "none", requestTimeoutSeconds: 30 };
    assert.deepEqual(keptTuning(local, tuned), tuned);
    assert.deepEqual(keptTuning(local, { ...local, reasoningEffort: "none" }), { ...local, reasoningEffort: "none" });
    assert.deepEqual(keptTuning({ ...local, model: "other" }, tuned), { ...local, model: "other" });
    const copilot: Model = { mode: "github", model: "m" };
    assert.deepEqual(keptTuning(copilot, tuned), copilot);
    assert.deepEqual(keptTuning(local, { ...copilot, reasoningEffort: "high" }), local);
    assert.deepEqual(keptTuning(copilot, { ...copilot, capabilities: ["vision"], reasoningEffort: "high" }), {
      ...copilot,
      capabilities: ["vision"],
      reasoningEffort: "high",
    });
  });

  it("refuses a provider it does not know that is no address, and writes nothing", async () => {
    const { oqas, model } = repository();
    const told = await oqas("model", "set", "--provider", "acme", "--model", "m");
    assert.equal(told.code, 3);
    assert.match(
      told.err,
      /^acme is no provider oqas knows nor the address of a server: name one of OpenAI, .*, or give the address of an OpenAI-compatible server\.\n$/,
    );
    assert.equal((await model()).mode, "provider-key");
  });
});

describe("oqas model, alone, in a terminal", () => {
  /** Waits for the screen to settle, then types. */
  const typing = async (screen: FakeTerminal, keys: string, seen: string): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    screen.type(keys);
    await screen.sees(seen);
  };

  it("sets the connection step by step, records it, and exits with 0", async () => {
    const screen = new FakeTerminal();
    const { oqas, model } = repository(
      { provider: { state: "connected", models: [{ id: "test-model", name: "test-model", reasoningEfforts: [] }] } },
      true,
      screen,
    );
    const ended = oqas("model");
    await screen.sees("How does the tool reach the model?");
    await typing(screen, "\r", "Address of the server");
    await typing(screen, "\r", "Variable that holds the key");
    await typing(screen, "\r", "Choose the model:");
    screen.type("\r");
    const told = await ended;
    assert.deepEqual([told.code, told.out], [0, "The model test-model is set, through http://127.0.0.1:9/v1.\n"]);
    assert.deepEqual(await model(), { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:9/v1", model: "test-model" });
  });

  it("asks for the key, unseen, when its variable holds none, tests with it, and saves it out of the test repository", async () => {
    const screen = new FakeTerminal();
    const { oqas, asked, model, saved } = repository(
      { provider: { state: "connected", models: [{ id: "test-model", name: "test-model", reasoningEfforts: [] }] } },
      true,
      screen,
    );
    const ended = oqas("model");
    await screen.sees("How does the tool reach the model?");
    await typing(screen, "\r", "Address of the server");
    await typing(screen, "\r", "Variable that holds the key");
    await screen.enter("LOCAL_KEY");
    await screen.sees("Key of the provider");
    await screen.sees("LOCAL_KEY holds no key here: type it, it is not shown.");
    await typing(screen, "sk-typed", "••••••••");
    assert.doesNotMatch(screen.text, /sk-typed/);
    await typing(screen, "\r", "Choose the model:");
    screen.type("\r");
    assert.equal((await ended).code, 0);
    assert.deepEqual(asked, [["provider", "http://127.0.0.1:9/v1", "sk-typed"]]);
    assert.deepEqual(await model(), {
      mode: "provider-key",
      provider: "openai",
      baseUrl: "http://127.0.0.1:9/v1",
      model: "test-model",
      apiKeyEnv: "LOCAL_KEY",
    });
    assert.deepEqual(saved(), { LOCAL_KEY: "sk-typed" });
  });

  it("leaves with Esc, changes nothing, and exits with 5", async () => {
    const screen = new FakeTerminal();
    const { oqas, model } = repository({}, true, screen);
    const ended = oqas("model");
    await screen.sees("How does the tool reach the model?");
    await typing(screen, "\u001B", "How does the tool reach the model?");
    const told = await ended;
    assert.deepEqual([told.code, told.err], [5, "Nothing changed.\n"]);
    assert.equal((await model()).model, "test-model");
  });

  it("tests the connection itself when given none to play", async () => {
    const screen = new FakeTerminal();
    const ended = repository({}, false, screen).oqas("model");
    await screen.sees("How does the tool reach the model?");
    await typing(screen, "\u001B", "How does the tool reach the model?");
    assert.equal((await ended).code, 5);
  });

  it("is refused where there is no terminal", async () => {
    const told = await repository().oqas("model");
    assert.equal(told.code, 3);
    assert.match(told.err, /^oqas model alone sets the connection step by step in a terminal, and this is not one/);
  });
});
