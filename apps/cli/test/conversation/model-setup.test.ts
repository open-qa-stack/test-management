import assert from "node:assert/strict";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { afterEach, describe, it } from "vitest";
import type { Model, ModelConnectionCheck } from "@open-qa-stack/domain";
import { checkText, ModelSetup, type SetupEnd } from "../../src/conversation/setup/model-setup/model-setup.ts";
import { PLAIN, UNICODE, staging, until } from "./screen.ts";

const ENTER = "\r";
const ESC = "\u001B";
const UP = "\u001B[A";
const DOWN = "\u001B[B";

afterEach(() => cleanup());

const COPILOT: Model = { mode: "github", model: "gpt-5" };
const MODELS = [
  { id: "gpt-5", name: "GPT-5", reasoningEfforts: [] },
  { id: "mini", name: "mini", reasoningEfforts: [] },
];

/** The setting on screen, the checks it answers in turn, what it saved, and how it ended. */
function staged(inForce: Model, checks: readonly (ModelConnectionCheck | Error)[], saving?: Error, theme = UNICODE) {
  const tested: Model[] = [];
  const saved: Model[] = [];
  const ends: SetupEnd[] = [];
  const { lastFrame, stdin } = render(
    createElement(ModelSetup, {
      inForce,
      check: (model) => {
        const answer = checks[tested.push(model) - 1]!;
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
      save: (model) => {
        saved.push(model);
        return saving === undefined ? Promise.resolve() : Promise.reject(saving);
      },
      reasonOf: (error) => `Told: ${(error as Error).message}`,
      onEnd: (end) => ends.push(end),
      theme,
    }),
  );
  const { screen, sees, press } = staging(lastFrame, stdin);
  return { tested, saved, ends, screen, sees, press };
}

describe("the setting of the connection to the model in a terminal", () => {
  it("lists the connections, tests the GitHub account, offers its models, and records the one chosen", async () => {
    const stage = staged(COPILOT, [{ state: "connected", account: "octo", models: MODELS }]);
    await stage.sees("How does the tool reach the model?");
    assert.match(
      stage.screen(),
      /GitHub account of this machine \(Copilot\)\n.*OpenAI[\s\S]*Another server \(type its address\)\nUp\/Down choose · Enter confirm · Esc leave/,
    );
    await stage.press(ENTER, "Connected with the GitHub account octo. Choose the model:");
    assert.match(stage.screen(), /GPT-5 \(gpt-5\)\n.*mini/);
    await stage.press(DOWN, /›?\s*mini/);
    await stage.press(ENTER, "Saving mini");
    await until(() => stage.ends.length === 1, "the end");
    assert.deepEqual(stage.ends, [{ saved: { mode: "github", model: "mini" } }]);
    assert.deepEqual(stage.saved, [{ mode: "github", model: "mini" }]);
  });

  it("asks a provider for the variable of its key, and another server for its address, refusing what is neither", async () => {
    const stage = staged(
      COPILOT,
      [
        { state: "key-missing", variable: "OPENAI_API_KEY" },
        { state: "key-refused", status: 401 },
      ],
      undefined,
      PLAIN,
    );
    await stage.press(DOWN, "OpenAI");
    await stage.press(ENTER, "Variable that holds the key");
    assert.match(stage.screen(), /OPENAI_API_KEY/);
    // A variable that holds no key asks for the key itself, which is not shown.
    await stage.press(ENTER, "OPENAI_API_KEY holds no key here: type it, it is not shown.");
    await stage.press(ENTER, "The key is expected.");
    await stage.press("sk-x", "••••");
    assert.doesNotMatch(stage.screen(), /sk-x/);
    await stage.press(ENTER, "The provider refused the key (status 401)");
    await stage.press(DOWN, "Choose another connection");
    await stage.press(ENTER, "How does the tool reach the model?");
    await stage.press(UP, "Another server");
    await stage.press(ENTER, "Address of the server");
    await stage.press("x", /> x/);
    await stage.press(ENTER, "An http:// or https:// address is expected.");
    assert.match(stage.screen(), /Enter confirm · Esc leave/);
    await stage.press(ESC, "Address of the server");
    await until(() => stage.ends.length === 1, "the end");
    assert.deepEqual(stage.ends, [{}]);
  });

  it("asks the name of a model a server does not list, tests again on demand, and tells what stops it", async () => {
    const server: Model = { mode: "provider-key", provider: "openai", baseUrl: "http://localhost:1234/v1", model: "qwen" };
    const stage = staged(server, [{ state: "unreachable", url: "http://localhost:1234/v1" }, { state: "connected" }], new Error("conflict"));
    await stage.press(ENTER, "Address of the server");
    await stage.press(ENTER, "Variable that holds the key");
    await stage.press(ENTER, "Nothing answers at http://localhost:1234/v1");
    await stage.press(ENTER, "type the name of the model");
    await stage.press(ENTER, "Saving qwen");
    await until(() => stage.ends.length === 1, "the end");
    assert.deepEqual(stage.ends, [{ error: "Told: conflict" }]);
    assert.equal(stage.tested.length, 2);
  });

  it("ends with the reason when the connection cannot be tested", async () => {
    const stage = staged(COPILOT, [new Error("down")]);
    await stage.press(ENTER, "Testing the connection");
    await until(() => stage.ends.length === 1, "the end");
    assert.deepEqual(stage.ends, [{ error: "Told: down" }]);
  });

  it("names the connection a model is recorded through", async () => {
    const server: Model = { mode: "provider-key", provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1" };
    const stage = staged(server, [{ state: "connected", models: [{ id: "gpt-4.1", name: "gpt-4.1", reasoningEfforts: [] }] }]);
    await stage.press(ENTER, "Variable that holds the key");
    await stage.press(ENTER, "Connected. Choose the model:");
    await stage.press(ENTER, "Saving gpt-4.1, through OpenAI");
    const other = staged({ ...server, baseUrl: "http://localhost:1/v1" }, [
      { state: "connected", models: [{ id: "gpt-4.1", name: "gpt-4.1", reasoningEfforts: [] }] },
    ]);
    await other.press(ENTER, "Address of the server");
    await other.press(ENTER, "Variable that holds the key");
    await other.press(ENTER, "Connected.");
    await other.press(ENTER, "Saving gpt-4.1, through http://localhost:1/v1");
  });

  it("tells where to give a key its variable holds none of, as the conversation reads it", () => {
    assert.equal(
      checkText({ state: "key-missing", variable: "OPENAI_API_KEY" }),
      "OPENAI_API_KEY holds no key here: give it with oqas secrets set OPENAI_API_KEY, or in the console, then test again.",
    );
  });
});
