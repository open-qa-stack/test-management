import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "vitest";
import type { Api } from "./built-console.ts";
import { builtConsole } from "./in-browser.ts";
import { PlayedInstance } from "./played-instance.ts";
import { SESSION_ID } from "./agent/session-fixture.ts";
import { DETAIL, EXECUTIONS } from "./executions/executions-fixture.ts";
import { ListedInstance } from "./tests/listed-instance.ts";

const app = builtConsole();

describe("the code of the console is covered in full", () => {
  it("runs every line of the entry point and of the application when the console is used in the browser", async () => {
    const source = (await readFile(new URL("../src/main.tsx", import.meta.url), "utf8")).split("\n");
    const mount = source.findIndex((line) => line.startsWith("createRoot(")) + 1;
    const instance = new PlayedInstance();
    instance.unlisted = true;
    // The menu counts the tests to review and those that failed last.
    const counted: Api = (request) => {
      if (request.path === "/api/tests/verdicts")
        return { status: 200, body: JSON.stringify({ items: [{ path: "a.spec.ts", title: "A", verdict: "failed" }] }) };
      if (request.path === "/api/reviews") return { status: 200, body: JSON.stringify({ tests: [], counts: { inReview: 3, setAside: 0 } }) };
      return instance.api(request);
    };
    const [main, application] = await app().measure(
      ["src/main.tsx", "src/app.tsx"],
      async (page) => {
        await page.getByRole("status").filter({ hasText: "The folder of the sessions cannot be read." }).waitFor();
        instance.unlisted = false;
        await page.locator(".nav .nav-count.ai", { hasText: "3" }).waitFor();
        await page.locator(".nav .nav-count.ko", { hasText: "1" }).waitFor();
        await page.getByRole("link", { name: /tester la recherche d'un client/ }).click();
        await page.getByText("I write the test now.").waitFor();
        await page.getByRole("switch", { name: "Actions" }).click();
        await page.getByText("2 actions", { exact: true }).click();
        await page
          .getByRole("link", { name: /voir la page consultée/ })
          .first()
          .click();
        await page.locator(".act.selected").waitFor();
        await page.getByRole("dialog", { name: /^Page consultée/ }).waitFor();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        // ? opens the help of the shortcuts, which Escape closes.
        await page.keyboard.press("Shift+?");
        await page.getByRole("dialog", { name: "Raccourcis clavier" }).waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.locator(".refusals > summary").click();
        await page.getByRole("button", { name: "Lire la suite" }).click();
        await page.getByRole("button", { name: "Replier", exact: true }).waitFor();
        const field = page.getByRole("textbox", { name: "Écrivez aux agents : préciser, corriger, ajouter un scénario" });
        await field.fill("   ");
        await field.press("Enter");
        instance.deaf = true;
        await field.fill("sans le profil");
        await field.press("Shift+Enter");
        await field.press("Enter");
        await page.getByText("La session vient de se terminer").waitFor();
        instance.deaf = false;
        await page.getByRole("button", { name: "Envoyer" }).click();
        await page.locator(".sent", { hasText: "sans le profil" }).waitFor();
        await page.getByRole("link", { name: "Arrêter la session" }).click();
        await page.getByRole("button", { name: "Arrêter la session" }).click();
        await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
        instance.obey();
        // A session that stopped is replayed at the pace the person asks, then shown whole again.
        await page.getByRole("button", { name: "Rejouer" }).click();
        await page.getByRole("button", { name: "Pause" }).waitFor();
        await page.waitForFunction(() => Number(document.querySelector(".playback-progress")?.getAttribute("aria-valuenow")) > 0);
        await page.getByRole("button", { name: "Changer la vitesse" }).click();
        await page.getByRole("button", { name: "Pause" }).click();
        await page.getByRole("button", { name: "Reprendre", exact: true }).waitFor();
        await page.getByRole("button", { name: "Aller au prochain verdict" }).click();
        await page.getByText("Plan accepté par le harnais").waitFor();
        await page.getByRole("button", { name: "Tout afficher" }).click();
        await page.getByRole("button", { name: "Rejouer" }).waitFor();
        await page.getByRole("textbox", { name: "Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…" }).fill("corriger le test");
        await page.getByRole("button", { name: "Poursuivre" }).click();
        await page.getByRole("button", { name: "Envoyer" }).waitFor();
        // Stopped again, it is picked up where it stopped, without a word to write.
        await page.getByRole("link", { name: "Arrêter la session" }).click();
        await page.getByRole("button", { name: "Arrêter la session" }).click();
        await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
        instance.obey();
        await page.getByRole("button", { name: "Reprendre la session" }).click();
        await page.getByRole("button", { name: "Envoyer" }).waitFor();
        assert.equal(instance.resumedWith.at(-1)?.text, "Reprends là où la session s’est arrêtée.");
        instance.down = true;
        await page.getByRole("alert").waitFor();
        instance.down = false;
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("   ");
        await page
          .locator("form.agent-home-prompt")
          .evaluate((form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        instance.refusal = "session_running";
        await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.getByText("La session est de nouveau en cours").waitFor();
        instance.refusal = undefined;
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.locator(".thread .request", { hasText: "vérifier le changement d'adresse" }).waitFor();
        // The menu folds as the person asks, and stays so at the next visit.
        await page.getByRole("button", { name: "Replier le menu" }).click();
        assert.equal(await page.evaluate(() => window.localStorage.getItem("oqas.navigation")), "folded");
        await page.getByRole("button", { name: "Déplier le menu" }).click();
        await page.getByRole("button", { name: "Replier le menu" }).waitFor();
      },
      counted,
    );
    assert.ok(main!.lines.includes(mount), `line ${mount} of src/main.tsx, the mount, is in the build`);
    assert.deepEqual(main!.uncovered, []);
    assert.ok(application!.lines.length > 20, "the application is in the build");
    assert.deepEqual(application!.uncovered, []);
  });

  it("runs every line of the button that copies the branch of a session or the link of a trace, which says when the browser refuses", async () => {
    const instance = new PlayedInstance();
    instance.complete();
    const listed = new ListedInstance();
    const [button] = await app().measure(
      ["src/ui/copy-button.tsx"],
      async (page) => {
        await page.goto(`http://console.test/#/agent/sessions/${SESSION_ID}`);
        const copy = page.getByRole("button", { name: "Copier le nom de la branche" });
        // A page served over plain HTTP has no clipboard, as one whose browser refuses: the person is told to select the text.
        await copy.click();
        await page.getByRole("status").filter({ hasText: "Copie impossible : sélectionnez le texte." }).waitFor();
        await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.resolve() }, configurable: true }));
        await copy.click();
        await page.getByRole("status").filter({ hasText: "Copié" }).waitFor();
        // On a phone, the link of a trace is copied whole, from the button that leads the screen.
        await page.setViewportSize({ width: 390, height: 800 });
        await page.goto(`http://console.test/#/executions/trace?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`);
        let copied = "";
        await page.exposeFunction("keepCopied", (text: string) => (copied = text));
        await page.evaluate(() =>
          Object.defineProperty(navigator, "clipboard", {
            value: { writeText: (text: string) => (window as unknown as { keepCopied: (text: string) => Promise<void> }).keepCopied(text) },
          }),
        );
        await page.getByRole("button", { name: "Copier le lien de la trace" }).click();
        await page.getByRole("status").filter({ hasText: "Copié" }).waitFor();
        assert.match(copied, /^http:\/\/console\.test\/.*#\/executions\/trace\?id=/);
      },
      async (request) => (request.path.startsWith("/api/tests") ? listed.api(request) : instance.api(request)),
    );
    assert.ok(button!.lines.length > 5, "the button is in the build");
    assert.deepEqual(button!.uncovered, []);
  });

  it("runs every line of the screen of the discovery when it is used in the browser, and opens the session kept to the domains picked", async () => {
    const instance = new PlayedInstance();
    const [screen] = await app().measure(
      ["src/discovery/discovery-page.tsx"],
      async (page) => {
        // An instance that does not answer is said so; before a cartography, it names no domain.
        instance.down = true;
        await page.goto("http://console.test/#/discovery");
        await page.getByRole("status").filter({ hasText: "L’instance ne répond pas" }).waitFor();
        instance.down = false;
        await page.getByText("Aucun domaine pour l’instant").waitFor({ timeout: 15_000 });
        instance.domains = [
          {
            id: "quotes",
            label: "Devis",
            description: "Les demandes de devis.",
            sources: [{ id: "quotes-db", applications: ["portal"], items: ["public.quotes"] }],
          },
          { id: "policies", label: "Polices", description: "Les contrats.", sources: [{ id: "guide", applications: [], items: ["Contrats"] }] },
        ];
        // A search narrows the domains, which are picked at once, then let go; a search left empty shows them all again.
        const search = page.getByRole("searchbox", { name: "Chercher un domaine" });
        await search.fill("devis", { timeout: 15_000 });
        await search.press("Enter");
        await page.waitForURL(/#\/discovery\?q=devis$/);
        await page.getByRole("button", { name: "Tout choisir" }).click();
        await page.getByRole("button", { name: "Ne rien choisir" }).click();
        await search.fill("");
        await search.press("Enter");
        await page.waitForURL(/#\/discovery$/);
        await page.getByRole("button", { name: "Tout choisir" }).click();
        await page.getByRole("button", { name: "Ne rien choisir" }).click();
        await page.getByRole("checkbox", { name: /^Devis/ }).check();
        await page.getByRole("checkbox", { name: /^Polices/ }).check();
        await page.getByRole("checkbox", { name: /^Polices/ }).uncheck();
        // A domain is excluded, which leaves what is picked, taken back, then renamed: once refused, then taken.
        await page.getByRole("checkbox", { name: /^Polices/ }).check();
        await page.locator('summary[aria-label="Actions du domaine Polices"]').click();
        await page.getByRole("button", { name: "Exclure Polices" }).click();
        await page.getByText("Domaines exclus").waitFor();
        await page.getByRole("button", { name: "Réintégrer" }).click();
        await page.locator('summary[aria-label="Actions du domaine Polices"]').click();
        await page.getByRole("link", { name: "Renommer Polices" }).click();
        await page.getByRole("dialog").getByLabel("Nom").fill("Contrats");
        instance.domainRefused = true;
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("alert").waitFor();
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("checkbox", { name: /^Contrats/ }).waitFor();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        // A session the instance refuses says why, and the person may ask again.
        instance.refusal = "error";
        await page.getByRole("button", { name: "Générer les tests" }).click();
        await page.getByRole("alert").filter({ hasText: "The API refuses in its own words." }).waitFor();
        instance.refusal = undefined;
        await page.getByRole("button", { name: "Générer les tests" }).click();
        await page.waitForURL(/#\/agent\/sessions\//);
        assert.deepEqual(instance.asked.at(-1), { request: "Écris les tests des domaines : Devis.", scope: { domains: ["quotes"] } });
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the scope of a session when it is chosen in the browser, and opens the session kept to it", async () => {
    const instance = new PlayedInstance();
    const domains = [
      { id: "quotes", label: "Devis", description: "Les demandes de devis.", sources: [] },
      { id: "policies", label: "Polices", description: "Les contrats.", sources: [] },
      { id: "customers", label: "Clients", description: "Les clients.", sources: [] },
    ];
    let told = false;
    const held: Api = (request) => {
      if (told && request.path === "/api/tests/verdicts")
        return { status: 200, body: JSON.stringify({ items: [{ path: "a.spec.ts", title: "A", verdict: "failed" }] }) };
      if (told && request.path === "/api/reviews") return { status: 200, body: JSON.stringify({ tests: [], counts: { inReview: 2, setAside: 0 } }) };
      return instance.api(request);
    };
    const [entry, picker, form] = await app().measure(
      ["src/agent/agent-home-page.tsx", "src/agent/scope-picker.tsx", "src/agent/request-form.tsx"],
      async (page) => {
        // Before a cartography, no domain is named; one environment goes with the request as it is. A phone folds the scope under its summary.
        await page.setViewportSize({ width: 390, height: 800 });
        await page.goto("http://console.test/#/agent");
        await page.getByText("Tout le projet · local").waitFor();
        await page.getByRole("button", { name: "Modifier" }).click();
        await page.getByRole("button", { name: "Fermer" }).click();
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.getByText("Domaines pas encore cartographiés").waitFor();
        await page.getByText("Environnement local").waitFor();
        instance.domains = domains;
        instance.staging = true;
        // The entry reads again what the project holds to start from: told now, where it was not before.
        told = true;
        await page.goto("http://console.test/#/tests");
        await page.goto("http://console.test/#/agent");
        // The entry reads the configuration and the domains again: the choice of the environment shows once it did.
        await page.locator(".scope-menu summary", { hasText: "Domaines" }).waitFor();
        await page.getByRole("link", { name: /Corriger le test échoué/ }).waitFor();
        await page.getByRole("link", { name: /Relire les 2 nouveaux tests/ }).waitFor();
        await page.getByLabel("Environnement").selectOption("staging", { timeout: 60_000 });
        await page.locator(".scope-menu summary", { hasText: "Domaines" }).click();
        for (const label of ["Devis", "Polices", "Clients"]) await page.getByRole("checkbox", { name: new RegExp(`^${label}`) }).check();
        await page.locator(".scope-menu summary", { hasText: "3 choisis" }).waitFor();
        await page.getByRole("checkbox", { name: /^Clients/ }).uncheck();
        await page.locator(".scope-menu summary", { hasText: "Devis, Polices" }).waitFor();
        await page.getByRole("button", { name: "tous" }).first().click();
        await page.locator(".scope-menu summary", { hasText: "Domaines" }).waitFor();
        await page.getByRole("checkbox", { name: /^Devis/ }).check();
        await page.locator(".scope-menu summary", { hasText: "Niveaux" }).click();
        await page.getByRole("checkbox", { name: "métier" }).check();
        // An empty request presses nothing; Enter alone writes a new line; a refusal is said; Ctrl+Enter sends.
        const field = page.getByRole("textbox", { name: "Dites aux agents quoi tester" });
        await field.fill("   ");
        await field.press("Control+Enter");
        await field.fill("couvrir les devis");
        await field.press("Enter");
        instance.refusal = "session_running";
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.getByRole("alert").waitFor();
        instance.refusal = undefined;
        await field.press("Control+Enter");
        await page.waitForURL(/#\/agent\/sessions\//);
        // Without a configuration, the request goes alone.
        instance.unconfigured = true;
        const refused = page.waitForResponse((response) => response.url().endsWith("/api/configuration") && response.status() === 500);
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        await refused;
        await page.evaluate(() => new Promise((settled) => requestAnimationFrame(settled)));
        assert.equal(await page.locator(".scope-picker").count(), 0);
      },
      held,
    );
    assert.deepEqual(instance.asked.at(-1), { request: "couvrir les devis", environment: "staging", scope: { domains: ["quotes"], levels: ["business"] } });
    assert.ok(entry!.lines.length > 0 && picker!.lines.length > 0 && form!.lines.length > 0, "the entry, the picker and the form are in the build");
    assert.deepEqual([entry!.uncovered, picker!.uncovered, form!.uncovered], [[], [], []]);
  });
});
