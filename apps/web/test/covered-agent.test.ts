import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "vitest";
import { builtConsole } from "./in-browser.ts";
import { PlayedInstance } from "./played-instance.ts";

const app = builtConsole();

describe("the code of the console is covered in full", () => {
  it("runs every line of the entry point and of the application when the console is used in the browser", async () => {
    const source = (await readFile(new URL("../src/main.tsx", import.meta.url), "utf8")).split("\n");
    const mount = source.findIndex((line) => line.startsWith("createRoot(")) + 1;
    const instance = new PlayedInstance();
    instance.unlisted = true;
    const [main, application] = await app().measure(
      ["src/main.tsx", "src/app.tsx"],
      async (page) => {
        await page.getByRole("status").filter({ hasText: "The folder of the sessions cannot be read." }).waitFor();
        instance.unlisted = false;
        await page.getByRole("link", { name: /tester la recherche d'un client/ }).click();
        await page.getByText("I write the test now.").waitFor();
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
        await page.locator(".refusals > summary").click();
        await page.getByRole("button", { name: "Lire la suite" }).click();
        await page.getByRole("button", { name: "Replier", exact: true }).waitFor();
        await page.getByRole("button", { name: "Rejouer" }).click();
        await page.getByRole("button", { name: "Pause" }).waitFor();
        await page.waitForFunction(() => Number(document.querySelector(".playback-progress")?.getAttribute("aria-valuenow")) > 0);
        await page.getByRole("button", { name: "Changer la vitesse" }).click();
        await page.getByRole("button", { name: "Pause" }).click();
        await page.getByRole("button", { name: "Reprendre" }).waitFor();
        await page.getByRole("button", { name: "Aller au prochain verdict" }).click();
        await page.getByText("Plan accepté par le harnais").waitFor();
        await page.getByRole("button", { name: "Revenir au direct" }).click();
        await page.getByRole("button", { name: "Rejouer" }).waitFor();
        const field = page.getByRole("textbox", { name: "Dites aux agents ce qu’il faut corriger" });
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
        await page.getByRole("link", { name: "Arrêter" }).click();
        await page.getByRole("button", { name: "Arrêter la session" }).click();
        await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
        instance.obey();
        await page.getByRole("textbox", { name: "Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…" }).fill("corriger le test");
        await page.getByRole("button", { name: "Poursuivre la session" }).click();
        await page.getByRole("button", { name: "Envoyer" }).waitFor();
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
        // The menu folds as the person asks, and stays so at the next visit; a trace opens with it folded, whatever is kept.
        await page.getByRole("button", { name: "Replier le menu" }).click();
        assert.equal(await page.evaluate(() => window.localStorage.getItem("oqas.navigation")), "folded");
        await page.getByRole("button", { name: "Déplier le menu" }).click();
        await page.goto("http://console.test/#/executions/trace?id=e1&path=a.spec.ts");
        await page.getByRole("button", { name: "Déplier le menu" }).click();
        await page.getByRole("button", { name: "Replier le menu" }).waitFor();
        await page.goto("http://console.test/#/agent");
        await page.getByRole("button", { name: "Replier le menu" }).waitFor();
      },
      instance.api,
    );
    assert.ok(main!.lines.includes(mount), `line ${mount} of src/main.tsx, the mount, is in the build`);
    assert.deepEqual(main!.uncovered, []);
    assert.ok(application!.lines.length > 20, "the application is in the build");
    assert.deepEqual(application!.uncovered, []);
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
        await page.getByRole("checkbox", { name: /^Devis/ }).check({ timeout: 15_000 });
        await page.getByRole("checkbox", { name: /^Polices/ }).check();
        await page.getByRole("checkbox", { name: /^Polices/ }).uncheck();
        // A session the instance refuses says why, and the person may ask again.
        instance.refusal = "error";
        await page.getByRole("button", { name: "Générer les tests de ce domaine" }).click();
        await page.getByRole("alert").filter({ hasText: "The API refuses in its own words." }).waitFor();
        instance.refusal = undefined;
        await page.getByRole("button", { name: "Générer les tests de ce domaine" }).click();
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
    const [entry, picker] = await app().measure(
      ["src/agent/agent-home-page.tsx", "src/agent/scope-picker.tsx"],
      async (page) => {
        // Before a cartography, no domain is named; one environment goes with the request as it is.
        await page.goto("http://console.test/#/agent");
        await page.getByText("Domaines : pas encore cartographiés").waitFor();
        await page.getByText("Environnement : local").waitFor();
        instance.domains = domains;
        instance.staging = true;
        await page.goto("http://console.test/#/tests");
        await page.goto("http://console.test/#/agent");
        // The entry reads the configuration and the domains again: the choice of the environment shows once it did.
        await page.getByText("Domaines : tous").waitFor();
        await page.getByLabel("Environnement :").selectOption("staging", { timeout: 60_000 });
        await page.getByText("Domaines : tous").click();
        for (const label of ["Devis", "Polices", "Clients"]) await page.getByRole("checkbox", { name: new RegExp(`^${label}`) }).check();
        await page.getByText("Domaines : 3 choisis").waitFor();
        await page.getByRole("checkbox", { name: /^Clients/ }).uncheck();
        await page.getByText("Domaines : Devis, Polices").waitFor();
        await page.getByRole("button", { name: "tous" }).first().click();
        await page.getByText("Domaines : tous").waitFor();
        await page.getByRole("checkbox", { name: /^Devis/ }).check();
        await page.getByText("Niveaux : tous").click();
        await page.getByRole("checkbox", { name: "métier" }).check();
        await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("couvrir les devis");
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.waitForURL(/#\/agent\/sessions\//);
        // Without a configuration, the request goes alone.
        instance.unconfigured = true;
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        await page.waitForTimeout(200);
        assert.equal(await page.locator(".scope-picker").count(), 0);
      },
      instance.api,
    );
    assert.deepEqual(instance.asked.at(-1), { request: "couvrir les devis", environment: "staging", scope: { domains: ["quotes"], levels: ["business"] } });
    assert.ok(entry!.lines.length > 0 && picker!.lines.length > 0, "the entry and the picker are in the build");
    assert.deepEqual([entry!.uncovered, picker!.uncovered], [[], []]);
  });
});
