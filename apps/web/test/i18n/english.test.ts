import assert from "node:assert/strict";
import { createElement, type ReactNode } from "react";
import { describe, it } from "vitest";
import { AgentHomeScreen } from "../../src/agent/agent-home-screen.tsx";
import { SessionScreen } from "../../src/agent/session-screen.tsx";
import { ConfigurationScreen, type ConfigurationControls } from "../../src/configuration/configuration-screen.tsx";
import { configurationAfter, INITIAL_CONFIGURATION } from "../../src/configuration/configuration-state.ts";
import { Console } from "../../src/console.tsx";
import { KnowledgeScreen } from "../../src/knowledge/knowledge-screen.tsx";
import { INITIAL_KNOWLEDGE, knowledgeAfter } from "../../src/knowledge/knowledge-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { RESOURCES } from "../../src/i18n/i18n.ts";
import { COMPLETED, liveOf, RUNNING } from "../agent/session-fixture.ts";
import { DOCUMENT, REVISIONS, VIEW } from "../configuration/configuration-fixture.ts";
import { at, render, textOf } from "../render.ts";
import { speaking } from "./in-language.ts";

const inEnglish = speaking("en");

/** What the person does on the screen of the configuration, which a static rendering never calls. */
const IGNORED = (): void => assert.fail("nothing is done");
const CONTROLS: ConfigurationControls = {
  change: IGNORED,
  click: IGNORED,
  save: IGNORED,
  discard: IGNORED,
  keepFile: IGNORED,
  keepChange: IGNORED,
  testModel: IGNORED,
  setUp: IGNORED,
};

/** The parts of the words of some resources around what they interpolate and mark up, long enough to be told apart from a name. */
function partsOf(words: object): string[] {
  return Object.values(words).flatMap((value) =>
    typeof value === "string"
      ? value
          .split(/\{\{[^}]*\}\}|<[^>]*>/)
          .map((part) => part.trim())
          .filter((part) => part.length > 5)
      : partsOf(value as object),
  );
}

/** The parts of the French words of the console that English never writes. */
const FRENCH = ((english: ReadonlySet<string>) => partsOf(RESOURCES.fr).filter((part) => !english.has(part)))(new Set(partsOf(RESOURCES.en)));

/** The text of a screen, which holds none of the French words of the console. */
function english(node: ReactNode): string {
  const text = textOf(render(node));
  assert.deepEqual(
    FRENCH.filter((part) => text.includes(part)),
    [],
  );
  return text;
}

describe("the console in English", () => {
  it("tells a session that ended: its facts, its thread, its plan, its verdicts and its composer", async () => {
    await inEnglish();
    const text = english(createElement(SessionScreen, { route: at("#/agent/sessions/x"), live: liveOf(COMPLETED), project: "p" }));
    assert.match(text, /tests passed Nov 15, 2026, 2:44:06 PM UTC · 1 min 54 sec · 3 actions · 50 requests to the model · \S+ Replay/);
    assert.match(text, /All Exchanges Actions Verdicts/);
    assert.match(text, /Your request: .* Harness hands over to Planner /);
    assert.match(text, /Planner explores the application and proposes the plan .* Reasoning /);
    assert.match(text, /Opened \/ in customer-management .* 900 ms Proposed a plan of 1 scenario /);
    assert.match(text, /Plan accepted by the harness 1 scenario .* Identifier search Level smoke Case nominal Application customer-management Details /);
    assert.match(text, /Harness automatic check refused PLAN-ELEMENT .* Read more Page at that moment /);
    assert.match(text, /Writing a test search Writer writes and runs the Playwright tests .* Verdict of the run: 1 test passed /);
    assert.match(text, /Tell the agents what to do next: correct a test, add a scenario… Go on with the session$/);
  });

  it("asks before it stops a session that goes on", async () => {
    await inEnglish();
    const text = english(createElement(SessionScreen, { route: at("#/agent/sessions/x?stop=ask"), live: liveOf(RUNNING), project: "p" }));
    assert.match(text, /live Nov 15, 2026, 2:44:06 PM UTC · 2 actions Stop Replay Stop this session\? Its agents stop as soon as they hand over/);
    assert.match(text, /Cancel Stop the session /);
    assert.match(text, /The agents are working|is working/);
  });

  it("lists the sessions under the request that opens one, and names the screens that lead nowhere", async () => {
    await inEnglish();
    const home = english(createElement(AgentHomeScreen, { project: "p", sessions: [RUNNING, COMPLETED], opening: { state: "idle" } }));
    assert.match(home, /^p \/ Agent What do we test\? Tell the agents what to test Start a session Sessions · 1 live /);
    assert.match(home, / · local · 1 min 54 sec · 50 requests to the model 1 \/ 1 test passed tests passed$/);
    assert.match(english(createElement(Console, { route: at("#/nowhere") })), /Page not found This address leads to no screen .* Back to the sessions$/);
  });

  it("shows the configuration, its languages among its settings", async () => {
    await inEnglish();
    const state = configurationAfter(INITIAL_CONFIGURATION, {
      type: "read",
      view: { ...VIEW, revision: { ...VIEW.revision!, document: { ...DOCUMENT, language: "fr" } } },
      revisions: REVISIONS,
    });
    const html = render(createElement(ConfigurationScreen, { project: "p", state, controls: CONTROLS }));
    const text = english(createElement(ConfigurationScreen, { project: "p", state, controls: CONTROLS }));
    assert.match(text, /Applications and environments .* Agents Model · what the agents think with Connection to the model /);
    assert.match(text, /Languages · what the product says, and what the tests say Language of the console and of the agents English Français /);
    assert.match(text, /Language of the tests English Français The titles, the steps and the intents of the tests written; their code stays in English\./);
    assert.match(
      html,
      /<select id="config-language" name="\/language" data-kind="choice"[^>]*><option value="en">English<\/option><option value="fr" selected="">Français<\/option>/,
    );
    assert.match(html, /<select id="config-design-testLanguage" name="\/design\/testLanguage"[^>]*><option value="en" selected="">English<\/option>/);
  });

  it("shows the knowledge, its sources and the documents of one, with the errors of an upload", async () => {
    await inEnglish();
    const state = [
      { type: "read", view: VIEW } as const,
      { type: "listed", source: "manuals", items: [{ name: "quotes.md", bytes: 1200, uploadedAt: "2026-11-18T09:00:00.000Z" }] } as const,
      {
        type: "refused",
        source: "manuals",
        refusal: {
          code: "invalid_documents",
          text: "Refused.",
          names: ["quotes.pdf"],
          errors: [{ kind: "structure", path: "/documents/0", rule: "document-format", message: "Markdown only." }],
        },
      } as const,
    ].reduce(knowledgeAfter, INITIAL_KNOWLEDGE);
    const controls = { upload: IGNORED, remove: IGNORED };
    const overview = english(createElement(KnowledgeScreen, { project: "p", route: parseRoute("#/knowledge"), state, controls }));
    assert.match(overview, /Knowledge Declare in the configuration The sources of each application, and where each is read from\./);
    assert.match(overview, /manuals Uploaded documents 1 document/);
    const source = english(
      createElement(KnowledgeScreen, { project: "p", route: parseRoute("#/knowledge/manuals?remove=quotes.md&document=quotes.md"), state, controls }),
    );
    assert.match(source, /quotes\.md 1\.2 kB · .* Remove Remove quotes\.md\? The document is deleted from the instance/);
    assert.match(
      source,
      /quotes\.pdf Only Markdown is read: a file ending with \.md or \.markdown\. Upload documents Markdown files 1 MB at most each, 20 at most at once\./,
    );
  });
});
