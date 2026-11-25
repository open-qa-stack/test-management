import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import type { OqasConfig } from "@open-qa-stack/domain";
import { terminalLanguage } from "../src/conversation/setup/project-setup/setup-project.ts";
import { FakeTerminal } from "./support/fake-terminal.ts";
import { Terminal, workspace } from "./support/terminal.ts";

let terminal: Terminal;
afterEach(() => terminal.close());

/** Waits for the screen to settle: Ink reads what is typed once it drew. */
const settled = (): Promise<unknown> => new Promise((resolve) => setTimeout(resolve, 50));

/** Waits for the screen to settle, then types a line and Enter. */
async function entering(screen: FakeTerminal, line: string): Promise<void> {
  await settled();
  await screen.enter(line);
}

/** Waits for the screen to settle, then types, and waits to see what follows. */
async function typing(screen: FakeTerminal, keys: string, seen: string | RegExp): Promise<void> {
  await settled();
  screen.type(keys);
  await screen.sees(seen);
}

const UP = "\u001B[A";
const DOWN = "\u001B[B";
const ESC = "\u001B";

describe("oqas, in a terminal, on a folder never configured", () => {
  it("sets the project up step by step, creates it as the console does, then opens the conversation", async () => {
    terminal = await Terminal.open([], { config: () => undefined });
    const screen = new FakeTerminal();
    const ended = terminal.oqas([], { env: { LANG: "en_US.UTF-8" }, io: { terminal: screen } });
    await screen.sees("Name of the application to test");
    // The folder is named first: the terminal wraps its long path.
    assert.match(screen.text, /The project is set up in\s/);
    await entering(screen, "Shop");
    await screen.sees("What does it expose?");
    await typing(screen, "\r", "Address of its user interface");
    await entering(screen, "http://127.0.0.1:9/");
    await screen.sees("What may the agents read?");
    // Documents, given later; then the database, which does not answer, and is given up.
    await typing(screen, `${DOWN}${DOWN}${DOWN}`, /❯ Add documents/);
    await typing(screen, "\r", "documents to give later");
    await typing(screen, `${UP}`, /❯ Add a database/);
    await typing(screen, "\r", "Name the connection string is kept under");
    await entering(screen, "DATABASE_URL");
    await screen.sees("Connection string");
    // The connection string is typed unseen.
    await typing(screen, "postgres://nobody@127.0.0.1:1/shop", "••••••");
    assert.doesNotMatch(screen.text, /nobody/);
    await typing(screen, "\r", "The source does not answer:");
    await typing(screen, ESC, "What may the agents read?");
    // Back on the list, the first line is chosen: going on is the last.
    await typing(screen, UP, /❯ Go on to the model/);
    await typing(screen, "\r", "How does the tool reach the model?");
    // Another server: the scripted one, with no key.
    await typing(screen, UP, /❯ Another server/);
    await typing(screen, "\r", "Address of the server");
    await entering(screen, terminal.server.baseUrl);
    await screen.sees("Variable that holds the key");
    await typing(screen, "\r", "type the name of the model");
    await entering(screen, "test-model");
    await screen.sees("Here is what will be created in");
    assert.match(
      screen.text,
      /The application Shop, at http:\/\/127\.0\.0\.1:9\/\n {2}1 knowledge source, mapped as soon as the project is created\n {2}The model test-model, through a provider key/,
    );
    await typing(screen, "\r", "What do we test?");
    await entering(screen, "/quit");
    const told = await ended;
    assert.equal(told.code, 0);
    assert.match(told.out, /^The project is set up in .*: its configuration, the Playwright project/);
    const config = (JSON.parse((await terminal.oqas(["config", "show", "--output", "json"])).out) as { revision: { document: OqasConfig } }).revision.document;
    assert.deepEqual(
      [config.language, config.applications[0]?.id, config.knowledge.map(({ id }) => id), config.model.model],
      ["en", "shop", ["documents"], "test-model"],
    );
    assert.ok(existsSync(join(terminal.root, "playwright.config.ts")));
  });

  it("makes a folder that is no git repository one, with its first commit, and tells why it could not go on", async () => {
    terminal = await Terminal.open([], { config: () => undefined });
    const folder = join(workspace, `fresh-${Date.now()}`);
    const screen = new FakeTerminal();
    const ended = terminal.oqas(["--repository", folder], { env: { LANG: "en_US.UTF-8" }, io: { terminal: screen } });
    await entering(screen, "Shop");
    await typing(screen, "\r", "Address of its user interface");
    await entering(screen, "http://127.0.0.1:9/");
    await typing(screen, UP, /❯ Go on to the model/);
    await typing(screen, "\r", "How does the tool reach the model?");
    await typing(screen, UP, /❯ Another server/);
    await typing(screen, "\r", "Address of the server");
    await entering(screen, terminal.server.baseUrl);
    // The key of the model is kept under a variable the environment does not set: it is typed, unseen.
    await entering(screen, "MODEL_KEY");
    await screen.sees("MODEL_KEY holds no key here");
    await typing(screen, "sk-typed", "••••••••");
    await typing(screen, "\r", "type the name of the model");
    await entering(screen, "test-model");
    await typing(screen, "\r", "What do we test?");
    await entering(screen, "/quit");
    const told = await ended;
    assert.match(told.out, /^The project is set up in .*: its configuration, the Playwright project, and a git repository with its first commit\.\n/);
    assert.ok(existsSync(join(folder, ".git")));
    assert.deepEqual(JSON.parse(readFileSync(join(folder, ".oqas", "secrets", "values.json"), "utf8")), { MODEL_KEY: "sk-typed" });
    const unreachable = new FakeTerminal();
    const failed = terminal.oqas(["--repository", join(workspace, `other-${Date.now()}`)], {
      env: { LANG: "en_US.UTF-8" },
      io: { terminal: unreachable, probes: { github: () => Promise.reject(new Error("no network")), provider: () => Promise.reject(new Error("no network")) } },
    });
    await entering(unreachable, "Shop");
    await typing(unreachable, "\r", "Address of its user interface");
    await entering(unreachable, "http://127.0.0.1:9/");
    await typing(unreachable, UP, /❯ Go on to the model/);
    await typing(unreachable, "\r", "How does the tool reach the model?");
    await typing(unreachable, "\r", "Testing");
    const stopped = await failed;
    assert.equal(stopped.code, 5);
    assert.match(stopped.err, /no network/);
  });

  it("keeps nothing when the person leaves, and exits with 5: the folder is set up again the next time", async () => {
    terminal = await Terminal.open([], { config: () => undefined });
    const screen = new FakeTerminal();
    const ended = terminal.oqas([], { env: { LANG: "fr_FR.UTF-8" }, io: { terminal: screen } });
    await screen.sees("Nom de l’application à tester");
    await typing(screen, ESC, "Nom de l’application à tester");
    const told = await ended;
    assert.deepEqual([told.code, told.err], [5, "Rien n’a été mis en place.\n"]);
    // Nothing was kept: the next time, the folder is set up again.
    const again = new FakeTerminal();
    const second = terminal.oqas([], { env: { LANG: "fr_FR.UTF-8" }, io: { terminal: again } });
    await again.sees("Nom de l’application à tester");
    await typing(again, ESC, "Nom de l’application à tester");
    assert.equal((await second).code, 5);
  });

  it("speaks the language of the terminal when the configuration speaks it, English otherwise", () => {
    assert.equal(terminalLanguage({ LC_ALL: "fr_FR.UTF-8", LANG: "en_US.UTF-8" }), "fr");
    assert.equal(terminalLanguage({ LC_MESSAGES: "fr_CA" }), "fr");
    assert.equal(terminalLanguage({ LANG: "de_DE.UTF-8" }), "en");
    assert.equal(terminalLanguage({}), "en");
  });
});
