import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Page } from "playwright-core";
import { EVENTS, SESSION_ID } from "./agent/session-fixture.ts";
import { ConfiguredInstance } from "./configuration/configured-instance.ts";
import { DocumentedInstance } from "./knowledge/documented-instance.ts";
import { builtConsole, focusedOf, LOOKED, overflowOf, SESSION, settled, TAP, tooSmallOf } from "./in-browser.ts";
import { OPENED_ID, PlayedInstance } from "./played-instance.ts";

const app = builtConsole();

describe("the console in a browser", () => {
  it("lists the sessions of the project and opens the thread of the one a person picks", async () => {
    const page = await app().open(1280, "", new PlayedInstance().api);
    try {
      await page.getByRole("link", { name: /tester la recherche d'un client/ }).click();
      await page.getByText("I write the test now.").waitFor();
      assert.equal(new URL(page.url()).hash, `#/agent/sessions/${SESSION_ID}`);
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "Session du 15 nov., 14:44 En direct");
      await page.goBack();
      await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
    } finally {
      await page.close();
    }
  });

  it("fills the thread while the agents work, each event once, then shows the verdict when the session completes", async () => {
    const instance = new PlayedInstance();
    instance.happened = 6;
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      const reasoning = page.locator(".thinking-text", { hasText: "I should open the application first." });
      await reasoning.waitFor({ state: "attached" });
      await page.getByRole("status").filter({ hasText: "travaille" }).waitFor();
      assert.equal(await page.getByText("I write the test now.").count(), 0);
      instance.happened = EVENTS.length;
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await reasoning.count(), 1);
      assert.deepEqual(instance.resumed.slice(0, 2), [undefined, "6"]);
      instance.complete();
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
      // The verdict and the end of the work are two renders: the sign that the agents work goes a moment after the verdict shows.
      await page.getByRole("status").filter({ hasText: "travaille" }).waitFor({ state: "detached" });
      assert.equal(instance.resumed.at(-1), String(EVENTS.length));
    } finally {
      await page.close();
    }
  });

  it("stops asking for the events of a session once its stream said it completed", async () => {
    const instance = new PlayedInstance();
    instance.complete();
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
      await page.waitForTimeout(1500);
      assert.deepEqual(instance.resumed, [undefined]);
    } finally {
      await page.close();
    }
  });

  it("recovers by itself, without a reload, when the stream of a session was refused then opens again", async () => {
    const instance = new PlayedInstance();
    instance.happened = 6;
    instance.streamDown = true;
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      await page.getByText("connexion au flux interrompue, nouvelle tentative…").waitFor();
      assert.equal(await page.locator(".thinking-text").count(), 0);
      instance.streamDown = false;
      await page.locator(".thinking-text", { hasText: "I should open the application first." }).waitFor({ state: "attached" });
      instance.streamDown = true;
      await page.getByText("connexion au flux interrompue, nouvelle tentative…").waitFor();
      instance.happened = EVENTS.length;
      instance.streamDown = false;
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await page.locator(".thinking-text", { hasText: "I should open the application first." }).count(), 1);
      assert.deepEqual(instance.resumed.slice(0, 2), [undefined, "6"]);
      assert.equal(await page.getByRole("alert").count(), 0);
    } finally {
      await page.close();
    }
  });

  it("opens by its address a session the list of the project does not have", async () => {
    const instance = new PlayedInstance();
    instance.listed = false;
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "Session du 15 nov., 14:44 En direct");
      await page.getByRole("link", { name: "Agent", exact: true }).first().click();
      await page.getByText("Aucune session pour l’instant").waitFor();
    } finally {
      await page.close();
    }
  });

  it("says a session is not found when the instance keeps none of that name", async () => {
    const page = await app().open(1280, "#/agent/sessions/oqas-gone", new PlayedInstance().api);
    try {
      await page.getByRole("heading", { level: 1, name: "Session introuvable" }).waitFor();
      assert.equal(await page.title(), "Session introuvable · Open QA Stack");
    } finally {
      await page.close();
    }
  });

  it("speaks the language of the configuration in force, which the page declares, and holds a phone in English as in French", async () => {
    const instance = new PlayedInstance();
    instance.language = "en";
    const page = await app().open(360, "#/agent", instance.api);
    try {
      await page.getByRole("heading", { name: "What do we test?" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      assert.equal(await overflowOf(page), 0, "the entry in English");
      await page.goto(`http://console.test/${SESSION}`);
      await page.getByRole("link", { name: "Stop the session" }).waitFor();
      assert.equal(await overflowOf(page), 0, "a session in English");
      await page.goto(`http://console.test/${LOOKED}`);
      await page.getByRole("dialog", { name: /^Page looked at/ }).waitFor();
      assert.equal(await overflowOf(page), 0, "a look in English");
    } finally {
      await page.close();
    }
    const french = await app().open(360, "#/agent", new PlayedInstance().api);
    try {
      await french.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
      assert.equal(await french.evaluate(() => document.documentElement.lang), "fr");
    } finally {
      await french.close();
    }
  });

  it("names the page after the screen, and moves the focus to its heading, as the person goes from one to another", async () => {
    const page = await app().open(1280, "#/agent", new PlayedInstance().api);
    const focused = (): Promise<string> => focusedOf(page);
    try {
      const link = page.getByRole("link", { name: /tester la recherche d'un client/ });
      await link.waitFor();
      assert.equal(await page.title(), "Agent · Open QA Stack");
      assert.equal(await focused(), "nothing");
      await link.click();
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await page.title(), "tester la recherche d'un client · Open QA Stack");
      assert.equal(await focused(), "H1: Session du 15 nov., 14:44 En direct");
      await page.getByRole("switch", { name: "Actions" }).click();
      await page.waitForURL(/actions=on/);
      assert.equal(await focused(), "A: Actions");
      await page.goto("http://console.test/#/nowhere");
      await page.getByRole("heading", { level: 1, name: "Page introuvable" }).waitFor();
      assert.equal(await page.title(), "Page introuvable · Open QA Stack");
      assert.equal(await focused(), "H1: Page introuvable");
      await page.goBack();
      await page.goBack();
      await page.goBack();
      await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
      assert.equal(await page.title(), "Agent · Open QA Stack");
      assert.equal(await focused(), "H1: Qu’est-ce qu’on teste ?");
    } finally {
      await page.close();
    }
  });

  it("opens the session a person asks for, and goes to its thread, where it waits in the queue", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("  vérifier le changement d'adresse  ");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByRole("heading", { level: 1, name: /^Session du / }).waitFor();
      assert.equal(new URL(page.url()).hash, `#/agent/sessions/${OPENED_ID}`);
      assert.deepEqual(instance.asked, [{ environment: "local", request: "vérifier le changement d'adresse" }]);
      await page.locator(".thread .request", { hasText: "vérifier le changement d'adresse" }).waitFor();
      assert.equal(await page.locator("h1 .badge").innerText(), "En file");
      assert.equal(await page.getByRole("status").filter({ hasText: "travaille" }).count(), 0);
      assert.equal(await page.getByRole("textbox", { name: "Écrivez aux agents : préciser, corriger, ajouter un scénario" }).isEnabled(), true);
    } finally {
      await page.close();
    }
  });

  it("starts a session with Ctrl+Enter in the request, once it holds a word, and with Enter alone writes a new line", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      const field = page.getByRole("textbox", { name: "Dites aux agents quoi tester" });
      const start = page.getByRole("button", { name: "Démarrer une session" });
      assert.equal(await start.isEnabled(), false);
      await field.fill("   ");
      await field.press("Control+Enter");
      assert.equal(await start.isEnabled(), false);
      await field.fill("vérifier le changement d'adresse");
      assert.equal(await start.isEnabled(), true);
      await field.press("Enter");
      assert.equal(await field.inputValue(), "vérifier le changement d'adresse\n");
      await field.press("Control+Enter");
      await page.getByRole("heading", { level: 1, name: /^Session du / }).waitFor();
      assert.deepEqual(instance.asked, [{ environment: "local", request: "vérifier le changement d'adresse" }]);
    } finally {
      await page.close();
    }
  });

  it("takes a message for a queued session, goes on with its thread once it started, and closes it when it completes", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      const field = page.getByRole("textbox", { name: "Écrivez aux agents : préciser, corriger, ajouter un scénario" });
      const state = page.locator("h1 .badge");
      const working = page.getByRole("status").filter({ hasText: "Planificateur travaille" });
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await field.fill("sans le profil");
      await field.press("Enter");
      await page.locator(".sent", { hasText: "sans le profil" }).getByText("en attente d’un agent").waitFor();
      assert.deepEqual(instance.said, [{ text: "sans le profil" }]);
      assert.equal(await state.innerText(), "En file");
      instance.take();
      await working.waitFor();
      await state.filter({ hasText: "En direct" }).waitFor();
      assert.equal(await page.locator(".thread .request").count(), 2, "what was said while it waited stays in the thread");
      assert.equal(await field.isEnabled(), true);
      instance.completeOpened();
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
      await state.filter({ hasText: "Réussi" }).waitFor();
      await field.waitFor({ state: "detached" });
      assert.equal(await working.count(), 0);
    } finally {
      await page.close();
    }
  });

  it("leaves a person who went elsewhere while the session opened where they are, the session listed when they come back", async () => {
    const instance = new PlayedInstance();
    let release = (): void => {};
    instance.hold = new Promise((resolve) => (release = resolve));
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByRole("button", { name: "Ouverture…" }).waitFor();
      await page.goto("http://console.test/#/nowhere");
      await page.getByRole("heading", { level: 1, name: "Page introuvable" }).waitFor();
      release();
      await page.waitForResponse((response) => response.request().method() === "POST");
      await page.getByRole("link", { name: "Revenir aux sessions" }).click();
      const row = page.getByRole("link", { name: /vérifier le changement d'adresse/ });
      await row.waitFor();
      assert.match(await row.innerText(), /vérifier le changement d'adresse\s+En file\s+.*en attente d’un agent$/);
      assert.equal(new URL(page.url()).hash, "#/agent");
    } finally {
      await page.close();
    }
  });

  it("says in its own words why the instance refused to open a session, and stays on the entry", async () => {
    const instance = new PlayedInstance();
    instance.refusal = "unavailable";
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByText("Aucune source de sessions n’est configurée sur cette instance.").waitFor();
      assert.equal(new URL(page.url()).hash, "#/agent");
    } finally {
      await page.close();
    }
  });

  it("says the instance cannot be reached, and recovers by itself when it can again", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("link", { name: /tester la recherche d'un client/ }).waitFor();
      instance.down = true;
      await page.getByRole("alert").waitFor();
      instance.down = false;
      await page.getByRole("alert").waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  });

  it("says why the instance could not list the sessions, without saying it is offline, then lists them when it can", async () => {
    const instance = new PlayedInstance();
    instance.unlisted = true;
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("status").filter({ hasText: "The folder of the sessions cannot be read." }).waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
      instance.unlisted = false;
      await page.getByRole("link", { name: /tester la recherche d'un client/ }).waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
    } finally {
      await page.close();
    }
  });
});

describe("the configuration in a browser", () => {
  /** The configuration of the instance, its form read. */
  async function configurationAt(width: number, instance = new ConfiguredInstance()): Promise<Page> {
    const page = await app().open(width, "#/configuration", instance.api);
    await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
    return page;
  }

  /** What a finger would miss among the fields of the form and the boxes it checks, besides the links and the buttons. */
  function tooSmallFieldsOf(page: Page): Promise<string[]> {
    return page.evaluate(
      (least) =>
        [...document.querySelectorAll(".config-field input, .config-field select, .check")]
          .map((element) => ({ element, box: element.getBoundingClientRect() }))
          .filter(({ box }) => Math.round(box.height * 100) < least * 100)
          .map(({ element, box }) => `${element.tagName} ${element.getAttribute("name") ?? element.textContent} ${box.height}`),
      TAP,
    );
  }

  it("fits a phone and a wide screen, every field and button a finger can press, what is typed at 16 px at least", async () => {
    for (const width of [390, 1440]) {
      const page = await configurationAt(width);
      try {
        // The history, the file and the JSON are folded at the foot of the screen.
        await page.getByRole("heading", { name: "Historique et copies des réglages" }).click();
        await page.locator("details.config-json summary").click();
        assert.equal(await overflowOf(page), 0, `${width}`);
        if (width < 1100) {
          // The tab of the other entries, which the configuration is one of, stands whole in the window.
          const box = await page.getByRole("link", { name: "Plus" }).boundingBox();
          assert.ok(box !== null && box.x >= 0 && box.x + box.width <= width, `the tab at ${width}`);
          assert.equal(await page.getByRole("button", { name: "Enregistrer" }).count(), 0, "nothing to save, no button to save");
          assert.deepEqual(await tooSmallOf(page), [], `${width}`);
          assert.deepEqual(await tooSmallFieldsOf(page), [], `${width}`);
          const size = await page.getByLabel("Modèle", { exact: true }).evaluate((field) => parseFloat(getComputedStyle(field).fontSize));
          assert.ok(size >= 16, `${size} px`);
        }
      } finally {
        await page.close();
      }
    }
  });

  it("shows beside its field the error the instance finds as the person types, then saves the change, which the history lists", async () => {
    const instance = new ConfiguredInstance();
    const page = await configurationAt(1440, instance);
    try {
      const model = page.getByLabel("Modèle", { exact: true });
      await model.fill("");
      await page.locator("#config-model-model-errors").filter({ hasText: "Ce champ ne peut pas être vide." }).waitFor();
      assert.equal(await model.getAttribute("aria-invalid"), "true");
      await page.getByText("1 erreur à corriger avant d’enregistrer").waitFor();
      await model.fill("other-model");
      await page.getByText("1 erreur à corriger").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await page.getByRole("status").filter({ hasText: "Révision 3 enregistrée" }).waitFor();
      await page.getByRole("heading", { name: "Historique et copies des réglages" }).click();
      await page.getByText("Révision 3", { exact: true }).waitFor();
      assert.equal(instance.saved[0]!.document.model.model, "other-model");
      assert.equal(await page.getByRole("button", { name: "Enregistrer" }).count(), 0);
    } finally {
      await page.close();
    }
  });

  it("takes a file that differs, and writes the revision in force to the file once a change is saved, each one press", async () => {
    const instance = new ConfiguredInstance();
    instance.fileChanged = true;
    const page = await configurationAt(390, instance);
    try {
      await page.getByRole("heading", { name: "Historique et copies des réglages" }).click();
      await page.getByText("oqas.json diffère de la révision en vigueur").waitFor();
      await page.getByRole("button", { name: "Prendre oqas.json" }).click();
      await page.getByRole("status").filter({ hasText: "Révision 3 enregistrée" }).waitFor();
      assert.equal(instance.revisions[0]!.origin, "file");
      await page.getByText("oqas.json contient la révision en vigueur.").waitFor();
      await page.getByLabel("Modèle", { exact: true }).fill("kept-model");
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await page.getByRole("status").filter({ hasText: "Révision 4 enregistrée" }).waitFor();
      assert.deepEqual(await tooSmallOf(page), []);
      await page.getByRole("button", { name: "Écrire oqas.json" }).click();
      await page.getByText("oqas.json contient la révision en vigueur.").waitFor();
      assert.equal(instance.fileChanged, false);
    } finally {
      await page.close();
    }
  });
});

describe("the knowledge in a browser", () => {
  /** The documents of the source the instance keeps, listed. */
  async function documentsAt(width: number, instance = new DocumentedInstance(), hash = "#/knowledge/manuals"): Promise<Page> {
    const page = await app().open(width, hash, instance.api);
    // The title is the identifier of the source only while the configuration is read: the name it then has is the one that stays.
    await page.getByRole("heading", { level: 1, name: "Documents déposés · Shop" }).waitFor();
    await page.getByRole("link", { name: "quotes.md", exact: true }).waitFor();
    return page;
  }

  it("fits a phone and a wide screen, the sources, the documents, a removal asked and a document read, every link and button a finger can press", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, "#/knowledge", new DocumentedInstance().api);
      try {
        await page.getByText("manuals").first().waitFor();
        await page.getByText("1 document", { exact: true }).waitFor();
        assert.equal(await overflowOf(page), 0, `overview at ${width}`);
        if (width < 1100) assert.deepEqual(await tooSmallOf(page), [], `overview at ${width}`);
        await page.goto(`http://console.test/#/knowledge/manuals?remove=quotes.md&document=quotes.md`);
        await page.getByRole("button", { name: "Retirer le document" }).waitFor();
        await page.getByText("A quote is priced.").waitFor();
        assert.equal(await overflowOf(page), 0, `source at ${width}`);
        if (width < 1100) assert.deepEqual(await tooSmallOf(page), [], `source at ${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("changes an attachment of a source in a panel: the whole of a phone, at the right of a wide screen, every button a finger can press", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, "#/knowledge/contract", new DocumentedInstance().api);
      try {
        await page.getByRole("link", { name: "Modifier Sert à : Shop, local › backend" }).click();
        const panel = page.getByRole("dialog", { name: "Rattachement 1" });
        await panel.getByLabel("Application", { exact: true }).waitFor();
        await settled(panel);
        const { height } = page.viewportSize()!;
        const box = (await panel.boundingBox())!;
        if (width < 720) {
          assert.deepEqual(box, { x: 0, y: 0, width, height }, "the panel covers the phone");
          assert.deepEqual(await tooSmallOf(page), [], `panel at ${width}`);
        } else {
          assert.equal(box.x + box.width, width, "the panel holds to the right edge");
          assert.ok(box.width < width / 2, `the panel is ${box.width} px wide`);
          assert.deepEqual([box.y, box.height], [0, height]);
        }
        assert.equal(await overflowOf(page), 0, `panel at ${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("uploads the files chosen, which the list then shows, and refuses beside the field a file it does not read", async () => {
    const instance = new DocumentedInstance();
    const page = await documentsAt(390, instance);
    try {
      const field = page.getByLabel("Fichiers Markdown");
      await field.setInputFiles([
        { name: "claims.md", mimeType: "text/markdown", buffer: Buffer.from("# Claims\n") },
        { name: "manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") },
      ]);
      await page.getByRole("button", { name: "Déposer", exact: true }).click();
      const refused = page.getByRole("alert").filter({ hasText: "manual.pdf Seul le Markdown est lu" });
      await refused.waitFor();
      assert.equal(await field.getAttribute("aria-invalid"), "true");
      assert.equal(instance.documents.size, 1);
      await field.setInputFiles([{ name: "claims.md", mimeType: "text/markdown", buffer: Buffer.from("# Claims\n") }]);
      await page.getByRole("button", { name: "Déposer", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "1 document déposé" }).waitFor();
      await page.getByRole("link", { name: "claims.md", exact: true }).waitFor();
      assert.equal(await field.evaluate((input: HTMLInputElement) => input.files?.length), 0);
      assert.equal(instance.documents.get("claims.md")?.text, "# Claims\n");
    } finally {
      await page.close();
    }
  });

  it("removes a document once the person confirmed it, and closes the confirmation", async () => {
    const instance = new DocumentedInstance();
    const page = await documentsAt(1440, instance);
    try {
      await page.getByRole("link", { name: "Retirer quotes.md" }).click();
      await page.getByRole("button", { name: "Retirer le document" }).click();
      await page.getByRole("status").filter({ hasText: "Document retiré." }).waitFor();
      await page.getByText("Aucun document pour l’instant").waitFor();
      assert.equal(new URL(page.url()).hash, "#/knowledge/manuals");
      assert.equal(instance.documents.size, 0);
    } finally {
      await page.close();
    }
  });
});
