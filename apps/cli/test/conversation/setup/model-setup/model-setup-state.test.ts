import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Model } from "@open-qa-stack/domain";
import {
  CONNECTIONS,
  offeredModels,
  setupAfter,
  setupStart,
  type SetupAction,
  type SetupState,
} from "../../../../src/conversation/setup/model-setup/model-setup-state.ts";

const LOCAL: Model = {
  mode: "provider-key",
  provider: "openai",
  baseUrl: "http://localhost:1234/v1",
  model: "qwen",
  apiKeyEnv: "LOCAL_KEY",
  reasoningEffort: "none",
};
const OPENAI: Model = { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1", apiKeyEnv: "MY_KEY" };
const COPILOT: Model = { mode: "github", model: "gpt-5" };
const MODELS = [
  { id: "gpt-4.1", name: "GPT-4.1", reasoningEfforts: [] },
  { id: "gpt-5", name: "GPT-5", reasoningEfforts: [] },
];

/** The setting after the actions, from the connection in force. */
const after = (inForce: Model, ...actions: SetupAction[]): SetupState => actions.reduce(setupAfter, setupStart(inForce));

/** The actions that choose a connection of the list, from the line of the connection in force. */
const choosing = (from: Model, choice: string): SetupAction[] => [
  { type: "moved", by: CONNECTIONS.indexOf(choice) - setupStart(from).selected },
  { type: "chosen" },
];

describe("the setting of the connection to the model", () => {
  it("starts on the connection in force, in the list of the connections", () => {
    assert.equal(CONNECTIONS[setupStart(COPILOT).selected], "github");
    assert.equal(CONNECTIONS[setupStart(OPENAI).selected], "OpenAI");
    assert.equal(CONNECTIONS[setupStart(LOCAL).selected], "other");
    assert.equal(after(COPILOT, { type: "moved", by: -1 }).selected, CONNECTIONS.length - 1);
  });

  it("tests the GitHub account at once, with the model in force when it was the account already", () => {
    assert.deepEqual(after(COPILOT, { type: "chosen" }).draft, COPILOT);
    const fromServer = after(LOCAL, ...choosing(LOCAL, "github"));
    assert.deepEqual([fromServer.step, fromServer.draft], ["testing", { mode: "github", model: "" }]);
  });

  it("asks a provider for the variable of its key, that of the provider or the one in force on the same server", () => {
    const named = after(COPILOT, ...choosing(COPILOT, "Mistral AI"));
    assert.deepEqual(
      [named.step, named.text, named.draft],
      ["key", "MISTRAL_API_KEY", { mode: "provider-key", provider: "openai", baseUrl: "https://api.mistral.ai/v1", model: "" }],
    );
    const same = after(OPENAI, { type: "chosen" });
    assert.deepEqual([same.text, same.draft.model], ["MY_KEY", "gpt-4.1"]);
  });

  it("asks another server for its address, then the variable of its key, refusing what is neither", () => {
    const address = after(COPILOT, ...choosing(COPILOT, "other"));
    assert.deepEqual([address.step, address.text], ["address", ""]);
    assert.equal(setupAfter({ ...address, text: "ftp://x" }, { type: "entered" }).refusal, "address");
    assert.equal(setupAfter({ ...address, text: "nowhere" }, { type: "entered" }).refusal, "address");
    const key = setupAfter({ ...address, text: " http://localhost:4321/v1 " }, { type: "entered" });
    assert.deepEqual([key.step, key.text, key.draft.mode === "provider-key" && key.draft.baseUrl], ["key", "", "http://localhost:4321/v1"]);
    assert.equal(setupAfter({ ...key, text: "lower-case" }, { type: "entered" }).refusal, "variable");
    const keyless = setupAfter(key, { type: "entered" });
    assert.deepEqual([keyless.step, keyless.draft], ["testing", { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:4321/v1", model: "" }]);
    const kept = after(LOCAL, { type: "chosen" });
    assert.deepEqual([kept.text, kept.pendingKey], ["http://localhost:1234/v1", "LOCAL_KEY"]);
    const typed = setupAfter(setupAfter(kept, { type: "typed", text: "http://localhost:1234/v1" }), { type: "entered" });
    assert.deepEqual([typed.step, typed.text, typed.pendingKey], ["key", "LOCAL_KEY", undefined]);
    const withKey = setupAfter(typed, { type: "entered" });
    assert.equal(withKey.draft.mode === "provider-key" && withKey.draft.apiKeyEnv, "LOCAL_KEY");
  });

  it("forgets a refusal once something is typed again", () => {
    const refused = setupAfter({ ...after(COPILOT, ...choosing(COPILOT, "other")), text: "x" }, { type: "entered" });
    assert.equal(setupAfter(refused, { type: "typed", text: "h" }).refusal, undefined);
  });

  it("offers the models the test found, on the one in force, and keeps its tuning when it is chosen again", () => {
    const tested = setupAfter(after(OPENAI, { type: "chosen" }, { type: "entered" }), { type: "tested", check: { state: "connected", models: MODELS } });
    assert.deepEqual([tested.step, tested.selected], ["model", 0]);
    const saving = setupAfter(setupAfter(tested, { type: "moved", by: 1 }), { type: "chosen" });
    assert.deepEqual([saving.step, saving.draft.model], ["saving", "gpt-5"]);
    assert.equal(setupAfter(saving, { type: "saved" }).step, "saved");
    const local = setupAfter(after(LOCAL, { type: "chosen" }, { type: "entered" }, { type: "entered" }), {
      type: "tested",
      check: { state: "connected", models: [{ id: "qwen", name: "qwen", reasoningEfforts: [] }] },
    });
    assert.deepEqual(setupAfter(local, { type: "chosen" }).draft, LOCAL);
    const absent = setupAfter(after(COPILOT, { type: "chosen" }), { type: "tested", check: { state: "connected", models: [MODELS[0]!] } });
    assert.equal(absent.selected, 0);
  });

  it("asks the name of the model when the server lists none, and refuses an empty one", () => {
    const name = setupAfter(after(LOCAL, { type: "chosen" }, { type: "entered" }, { type: "entered" }), { type: "tested", check: { state: "connected" } });
    assert.deepEqual([name.step, name.text], ["name", "qwen"]);
    assert.equal(setupAfter({ ...name, text: " " }, { type: "entered" }).refusal, "name");
    assert.equal(setupAfter(name, { type: "entered" }).step, "saving");
    const github = setupAfter(after(COPILOT, { type: "chosen" }), { type: "tested", check: { state: "connected" } });
    assert.equal(setupAfter(github, { type: "entered" }).step, "saving");
  });

  it("offers to test again or to choose another connection when the model does not answer", () => {
    const failed = setupAfter(after(COPILOT, { type: "chosen" }), { type: "tested", check: { state: "signed-out" } });
    assert.deepEqual([failed.step, failed.selected], ["failed", 0]);
    assert.equal(setupAfter(failed, { type: "chosen" }).step, "testing");
    assert.deepEqual(setupAfter(setupAfter(failed, { type: "moved", by: 1 }), { type: "chosen" }), setupStart(COPILOT));
  });

  it("offers no model before a test, nor after one that found no list", () => {
    assert.deepEqual(offeredModels(setupStart(COPILOT)), []);
    assert.deepEqual(offeredModels(setupAfter(after(COPILOT, { type: "chosen" }), { type: "tested", check: { state: "connected" } })), []);
  });

  it("ignores what does not belong to the step it is at", () => {
    const start = setupStart(COPILOT);
    const testing = after(COPILOT, { type: "chosen" });
    assert.equal(setupAfter(testing, { type: "moved", by: 1 }), testing);
    assert.equal(setupAfter(testing, { type: "chosen" }), testing);
    assert.equal(setupAfter(testing, { type: "entered" }), testing);
    const serverTesting = after(OPENAI, { type: "chosen" }, { type: "entered" });
    assert.equal(setupAfter(serverTesting, { type: "entered" }), serverTesting);
    assert.equal(setupAfter(start, { type: "tested", check: { state: "connected" } }), start);
    assert.equal(setupAfter(start, { type: "saved" }), start);
  });

  it("asks for the key itself when the variable holds none, then tests with it and saves it with the connection", () => {
    const missing = setupAfter(after(OPENAI, { type: "chosen" }, { type: "entered" }), { type: "tested", check: { state: "key-missing", variable: "MY_KEY" } });
    assert.deepEqual([missing.step, missing.text], ["secret", ""]);
    assert.equal(setupAfter(missing, { type: "entered" }).refusal, "secret");
    const typed = setupAfter(setupAfter(missing, { type: "typed", text: " sk-typed " }), { type: "entered" });
    assert.deepEqual([typed.step, typed.typedKey], ["testing", "sk-typed"]);
    const chosen = [{ type: "tested", check: { state: "connected", models: MODELS } }, { type: "chosen" }] as const;
    assert.equal(chosen.reduce(setupAfter, typed).typedKey, "sk-typed");
    // A key typed for one connection is not another's.
    const other = setupAfter(setupStart(OPENAI), { type: "chosen" });
    assert.equal(setupAfter({ ...other, ...typed, step: "connection" }, { type: "chosen" }).typedKey, undefined);
  });
});
