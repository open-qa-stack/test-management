import assert from "node:assert/strict";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { afterEach, describe, it } from "vitest";
import type { Knowledge, ModelConnectionCheck, RepositoryPreparation, SourceCheck } from "@open-qa-stack/domain";
import { ProjectSetup, summaryLines, type ProjectSetupEnd } from "../../src/solo/conversation/project-setup/project-setup.ts";
import type { ProjectDraft } from "../../src/solo/conversation/project-setup/project-draft.ts";
import { PLAIN, UNICODE, until } from "./screen.ts";

const ENTER = "\r";
const ESC = "\u001B";
const UP = "\u001B[A";
const DOWN = "\u001B[B";

afterEach(() => cleanup());

/** What a test plays: the answers of the tests of the sources, of the model, and of the creation. */
interface Played {
  readonly sources?: readonly (SourceCheck | Error)[];
  readonly model?: ModelConnectionCheck | Error;
  readonly created?: RepositoryPreparation | Error;
}

/** The setting up on screen, what it was asked, and how it ended. */
function staged(played: Played = {}, theme = UNICODE) {
  const tested: { source: Knowledge; value: string | undefined }[] = [];
  const created: ProjectDraft[] = [];
  const ends: ProjectSetupEnd[] = [];
  const answer = <T>(value: T | Error): Promise<T> => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  const { lastFrame, stdin } = render(
    createElement(ProjectSetup, {
      folder: "/work/shop-tests",
      check: (source, value) => {
        tested.push({ source, value });
        return answer<SourceCheck>(played.sources?.[tested.length - 1] ?? { state: "ok", items: 2 });
      },
      checkModel: () => answer<ModelConnectionCheck>(played.model ?? { state: "connected" }),
      create: (draft) => {
        created.push(draft);
        return answer<RepositoryPreparation>(played.created ?? { created: [], kept: [], committed: true });
      },
      reasonOf: (error) => `Told: ${(error as Error).message}`,
      onEnd: (end) => ends.push(end),
      theme,
    }),
  );
  const screen = (): string => String(lastFrame());
  const sees = (seen: string | RegExp): Promise<void> =>
    until(() => (typeof seen === "string" ? screen().includes(seen) : seen.test(screen())), `${String(seen)}\n${screen()}`);
  const press = async (keys: string, seen: string | RegExp): Promise<void> => {
    // Ink reads what is typed once it drew: each key goes alone.
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.write(keys);
    await sees(seen);
  };
  return { tested, created, ends, screen, sees, press };
}

describe("the setting up of a project in a terminal", () => {
  it("names the folder, refuses an empty name, and leaves with Esc, nothing created", async () => {
    const stage = staged({}, PLAIN);
    await stage.sees("The project is set up in /work/shop-tests.");
    await stage.press(ENTER, "The name of the application is expected.");
    await stage.press(ESC, "Name of the application to test");
    await until(() => stage.ends.length === 1, "the end");
    assert.deepEqual([stage.ends, stage.created], [[{}], []]);
  });

  it("asks an API alone for its address, tests the code, says what each source holds, and creates the project", async () => {
    const stage = staged({
      sources: [
        { state: "ok", items: 0 },
        { state: "ok", items: 1 },
      ],
    });
    await stage.press("Shop", "Shop");
    await stage.press(ENTER, "What does it expose?");
    await stage.press(DOWN, /❯ An API/);
    await stage.press(ENTER, "Address of its API");
    await stage.press("http://localhost:8080", "http://localhost:8080");
    await stage.press(ENTER, "What may the agents read?");
    await stage.press(DOWN, /❯ Add the source code/);
    await stage.press(ENTER, "Folder of the source code");
    await stage.press("../shop", "../shop");
    await stage.press(ENTER, "code  source code  answers, holds nothing yet");
    // Back on the list, its first line is chosen.
    await stage.sees(/❯ Add a contract/);
    await stage.press(ENTER, "Address or path of the contract");
    await stage.press("openapi.json", "openapi.json");
    await stage.press(ENTER, "api-contract  contract of the API  answers, 1 item");
    assert.deepEqual(
      stage.tested.map(({ source }) => source.id),
      ["code", "api-contract"],
    );
    await stage.press(UP, /❯ Go on to the model/);
    await stage.press(ENTER, "How does the tool reach the model?");
    await stage.press(ENTER, "type the name of the model");
    await stage.press("gpt-5", "gpt-5");
    await stage.press(ENTER, "Here is what will be created in /work/shop-tests:");
    assert.match(
      stage.screen(),
      /The application Shop, at http:\/\/localhost:8080\n {2}2 knowledge sources, mapped as soon as the project is created\n {2}The model gpt-5, through the GitHub account of this machine/,
    );
    await stage.press(ENTER, "Creating the project…");
    await until(() => stage.ends.length === 1, "the end");
    assert.deepEqual(stage.ends, [{ created: { created: [], kept: [], committed: true } }]);
    assert.deepEqual([stage.created[0]?.exposes, stage.created[0]?.apiUrl, stage.created[0]?.uiUrl], ["api", "http://localhost:8080", undefined]);
  });

  it("asks an application of both kinds for both addresses, tells a test that failed, and many items", async () => {
    const stage = staged({ sources: [new Error("down"), { state: "ok", items: 7 }] });
    await stage.press("Shop", "Shop");
    await stage.press(ENTER, "What does it expose?");
    await stage.press(UP, /❯ A user interface and an API/);
    await stage.press(ENTER, "Address of its user interface");
    await stage.press("http://localhost:3000", "http://localhost:3000");
    await stage.press(ENTER, "Address of its API");
    await stage.press("http://localhost:8080", "http://localhost:8080");
    await stage.press(ENTER, "What may the agents read?");
    await stage.press(ENTER, "Address or path of the contract");
    await stage.press("openapi.json", "openapi.json");
    await stage.press(ENTER, "The source does not answer: Told: down");
    await stage.press(ENTER, "answers, 7 items");
  });

  it("ends with the reason when the model cannot be tested, or the project cannot be created", async () => {
    const unreachable = staged({ model: new Error("no network") });
    await unreachable.press("Shop", "Shop");
    await unreachable.press(ENTER, "What does it expose?");
    await unreachable.press(ENTER, "Address of its user interface");
    await unreachable.press("http://localhost:3000", "http://localhost:3000");
    await unreachable.press(ENTER, "What may the agents read?");
    await unreachable.press(UP, /❯ Go on to the model/);
    await unreachable.press(ENTER, "How does the tool reach the model?");
    await unreachable.press(ENTER, "Testing");
    await until(() => unreachable.ends.length === 1, "the end");
    assert.deepEqual(unreachable.ends, [{ error: "Told: no network" }]);
    cleanup();
    const left = staged();
    await left.press("Shop", "Shop");
    await left.press(ENTER, "What does it expose?");
    await left.press(ENTER, "Address of its user interface");
    await left.press("http://localhost:3000", "http://localhost:3000");
    await left.press(ENTER, "What may the agents read?");
    await left.press(UP, /❯ Go on to the model/);
    await left.press(ENTER, "How does the tool reach the model?");
    await left.press(ESC, "How does the tool reach the model?");
    await until(() => left.ends.length === 1, "the end");
    assert.deepEqual(left.ends, [{}]);
    cleanup();
    const refused = staged({ created: new Error("the disk is full") });
    await refused.press("Shop", "Shop");
    await refused.press(ENTER, "What does it expose?");
    await refused.press(ENTER, "Address of its user interface");
    await refused.press("http://localhost:3000", "http://localhost:3000");
    await refused.press(ENTER, "What may the agents read?");
    await refused.press(UP, /❯ Go on to the model/);
    await refused.press(ENTER, "How does the tool reach the model?");
    await refused.press(ENTER, "type the name of the model");
    await refused.press("gpt-5", "gpt-5");
    await refused.press(ENTER, "Here is what will be created");
    await refused.press(ENTER, "Creating");
    await until(() => refused.ends.length === 1, "the end");
    assert.deepEqual(refused.ends, [{ error: "Told: the disk is full" }]);
  });

  it("sums up a model reached with a provider key", () => {
    const draft: ProjectDraft = {
      name: "Shop",
      exposes: "web",
      uiUrl: "http://x",
      sources: [],
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://x/v1", model: "m" },
    };
    assert.deepEqual(summaryLines(draft), ["The application Shop, at http://x", "No knowledge source yet", "The model m, through a provider key"]);
  });
});
