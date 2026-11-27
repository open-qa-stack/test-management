import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ConfiguredInstance } from "./configuration/configured-instance.ts";
import { DocumentedInstance } from "./knowledge/documented-instance.ts";
import { DETAIL, EXECUTIONS } from "./executions/executions-fixture.ts";
import { builtConsole, overflowOf, settled, tooSmallOf } from "./in-browser.ts";
import { ListedInstance } from "./tests/listed-instance.ts";
import { ReviewedInstance } from "./review/reviewed-instance.ts";
import { POLICY } from "./review/review-fixture.ts";
import { DEFECTS } from "./defects/defects-fixture.ts";
import { DETAIL as DETAIL_TEST } from "./tests/tests-fixture.ts";

const app = builtConsole();

describe("the code of the console is covered in full", () => {
  it("runs every line of the screen of the defects in the browser, from the menu, and moves a defect as the person asks", async () => {
    const instance = new ListedInstance();
    instance.defects = [...DEFECTS.items];
    const [screen] = await app().measure(
      ["src/defects/defects-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/agent");
        await page.getByRole("link", { name: "Anomalies" }).first().click();
        await page.waitForURL(/#\/defects$/);
        await page.getByText("The premium shows 0").waitFor();
        await page.getByRole("button", { name: "Marquer corrigée" }).click();
        await page.getByText("Aucune anomalie ouverte").waitFor();
        assert.deepEqual(instance.defects.find(({ id }) => id === "D-3")?.status, "fixed");
        // A move the instance refuses says why, and leaves the defect where it is.
        await page.getByRole("link", { name: /À rejouer/ }).click();
        instance.defectRefusal = "unknown_defect";
        await page.getByRole("button", { name: "Rouvrir" }).first().click();
        await page.getByText("L’instance ne garde plus cette anomalie.").waitFor();
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 0, "the module is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the screen of the review in the browser, from the menu, and goes through its tests with J and K", async () => {
    const instance = new ReviewedInstance();
    const [screen] = await app().measure(
      ["src/review/review-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/agent");
        await page.getByRole("link", { name: "À relire" }).first().click();
        await page.waitForURL(/#\/review$/);
        await page.getByRole("heading", { name: "A quote expires after thirty days" }).waitFor();
        // J goes to the next test, K back; neither goes past the ends of the list.
        await page.keyboard.press("j");
        await page.waitForURL(new RegExp(`#/review\\?id=${POLICY.id}$`));
        await page.getByRole("heading", { name: "Edit the dates of a policy" }).waitFor();
        await page.keyboard.press("j");
        await page.keyboard.press("k");
        await page.getByRole("heading", { name: "A quote expires after thirty days" }).waitFor();
        await page.keyboard.press("k");
        // A test no design gives any more says so on its card.
        instance.queue = { ...instance.queue, tests: [...instance.queue.tests, { ...POLICY, id: "44444444-4444-4444-8444-444444444444", title: "Gone" }] };
        await page.goto("http://console.test/#/review?id=44444444-4444-4444-8444-444444444444");
        await page.getByText("Aucun test écrit par les agents ne porte plus cet identifiant.").waitFor();
        // An empty view has no test to go through.
        await page.goto("http://console.test/#/review?view=updates");
        await page.getByText("Aucune mise à jour").waitFor();
        await page.keyboard.press("j");
        // V validates the test shown; the next one is shown, and the screen says where it went.
        await page.goto("http://console.test/#/review");
        await page.getByRole("heading", { name: "A quote expires after thirty days" }).waitFor();
        await page.keyboard.press("v");
        await page.getByText("Validé : le test est entré dans main, commité ; rien n’a été poussé.").waitFor();
        await page.getByRole("heading", { name: "Edit the dates of a policy" }).waitFor();
        // A test the branch had already is validated without a commit, from a view narrowed to its domain.
        instance.committed = false;
        const closing = { ...POLICY, id: "55555555-5555-4555-8555-555555555555", title: "Close a policy" };
        instance.queue = { ...instance.queue, tests: [...instance.queue.tests, closing] };
        instance.proposals.set(closing.id, { ...instance.proposals.get(POLICY.id)!, ...closing });
        await page.goto("http://console.test/#/review?domain=policies");
        await page.getByRole("link", { name: /Close a policy/ }).click();
        await page.getByRole("heading", { name: "Close a policy" }).waitFor();
        await page.keyboard.press("v");
        await page.getByText("Validé : main l’avait déjà tel que la conception l’a écrit.").waitFor();
        await page.waitForURL(/#\/review\?domain=policies$/);
        // A decision the instance refuses says why, and leaves the test where it is.
        instance.refusal = "review_refused";
        await page.getByRole("button", { name: "Valider" }).click();
        await page.getByText("Ce test ne peut pas entrer dans le dépôt maintenant").waitFor();
        // Set aside asks why in its panel: covered names the test that covers it.
        await page.getByRole("link", { name: "Écarter" }).click();
        await page.getByRole("dialog").getByLabel("Déjà couvert par un autre test").check();
        await page.getByRole("dialog").getByRole("button", { name: "Écarter ce test" }).click();
        await page.getByText("Choisissez un motif").waitFor();
        await page.getByRole("dialog").getByLabel("Le test qui le couvre déjà").fill("apps/policy-management/tests/x.spec.ts");
        await page.getByRole("dialog").getByLabel("Précision").fill("Same steps.");
        await page.getByRole("dialog").getByRole("button", { name: "Écarter ce test" }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByText("Écarté : le test reste consultable dans « Écartés ».").waitFor();
        assert.deepEqual(instance.decisions, [
          { id: "11111111-1111-4111-8111-111111111111", decision: { status: "validated" } },
          { id: "55555555-5555-4555-8555-555555555555", decision: { status: "validated" } },
          { id: POLICY.id, decision: { status: "set_aside", reason: "covered", coveredBy: "apps/policy-management/tests/x.spec.ts", note: "Same steps." } },
        ]);
        // V does nothing on a test set aside.
        await page.goto("http://console.test/#/review?view=set_aside");
        await page.getByText("Écarté : déjà couvert — apps/policy-management/tests/x.spec.ts · Same steps.").waitFor();
        await page.keyboard.press("v");
        assert.equal(instance.decisions.length, 3);
        // A test set aside goes back in review, once the instance takes it; a refusal says why.
        instance.refusal = "review_refused";
        await page.getByRole("button", { name: "Remettre en relecture" }).click();
        await page.locator(".review-refusal").waitFor();
        await page.getByRole("button", { name: "Remettre en relecture" }).click();
        await page.getByText("Remis en relecture : le test attend de nouveau votre décision dans « Nouveaux tests ».").waitFor();
        assert.deepEqual(instance.restored, [POLICY.id]);
        // A queue the instance no longer gives stays shown, with why.
        instance.unread = true;
        await page.getByRole("alert").waitFor();
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 0, "the module is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("lets the screen of the tests, its long paths and its filter, fit the width of a small phone", async () => {
    const page = await app().open(360, "#/tests", new ListedInstance().api);
    try {
      await page.locator(".tests-row").first().waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("runs every line of the card of a test when it is used in the browser, from the list of the tests, and leads to its latest result", async () => {
    const instance = new ListedInstance();
    const [screen, relaunch] = await app().measure(
      ["src/tests/test-page.tsx", "src/tests/use-relaunch.ts"],
      async (page) => {
        await page.goto("http://console.test/#/tests");
        await page.getByRole("link", { name: /Display the detail of a policy/ }).click();
        await page.waitForURL(/#\/tests\/view\?path=apps%2Fpolicy-management%2F/);
        await page.getByText("Open the policy of the customer", { exact: true }).waitFor();
        // A title saved closes its panel; a change the instance refuses keeps it open, with why.
        await page.getByRole("link", { name: "Modifier le titre" }).click();
        await page.getByRole("dialog").getByLabel("Titre", { exact: true }).fill("Show the detail of a policy");
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        instance.changeRefusal = "unknown_test";
        await page.getByRole("link", { name: "Modifier l’étape 1" }).click();
        await page.getByRole("dialog").getByLabel("Ce que fait l’étape").fill("Open the policy");
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByText("Le dépôt ne contient plus ce test").waitFor();
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        instance.refusal = "launch_refused";
        await page.getByRole("button", { name: "Relancer ce test" }).click();
        await page.getByText("Les tests ne peuvent pas être lancés maintenant").waitFor();
        await page.getByRole("button", { name: "Relancer ce test" }).click();
        await page.getByText("Relance en cours").waitFor();
        instance.launches = { last: { ...instance.launches.running!, endedAt: "2026-11-20T10:02:00.000Z", execution: "e1" } };
        await page.getByRole("button", { name: "Relancer ce test" }).and(page.locator(":enabled")).waitFor();
        // The key R presses the button, but not while the person types in a panel nor with a modifier.
        instance.launches = {};
        await page.getByRole("link", { name: "Modifier le titre" }).click();
        await page.getByRole("dialog").getByLabel("Titre", { exact: true }).press("r");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.keyboard.press("Shift+R");
        assert.equal(instance.launches.running, undefined);
        await page.keyboard.press("r");
        await page.getByText("Relance en cours").waitFor();
        instance.launches = {};
        // Without a configuration, the test runs again in the environment of the project.
        instance.unconfigured = true;
        await page.goto("http://console.test/#/tests");
        await page.goBack();
        await page.getByRole("button", { name: "Relancer ce test" }).waitFor();
        instance.unconfigured = false;
        // A test whose last run failed reports a defect, written from its failure; the defects then list it.
        const executions = instance.executions;
        const [latest] = executions;
        instance.executions = [{ ...latest!, results: [{ ...latest!.results[1]!, title: DETAIL_TEST.title }] }, ...executions.slice(1)];
        // The card reads the executions again at its pace, and shows the failure.
        await page.getByRole("link", { name: "Signaler l’anomalie" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Titre", { exact: true }).fill(" ");
        await dialog.getByRole("button", { name: "Créer l’anomalie" }).click();
        await dialog.getByText("Donnez un titre à l’anomalie.").waitFor();
        await dialog.getByLabel("Titre", { exact: true }).fill("The policy is refused");
        instance.defectRefusal = "invalid_request";
        await dialog.getByRole("button", { name: "Créer l’anomalie" }).click();
        await dialog.getByRole("alert").waitFor();
        await dialog.getByRole("button", { name: "Créer l’anomalie" }).click();
        await page.waitForURL(/#\/defects$/);
        assert.deepEqual(
          instance.defects.map(({ title, severity, test, execution }) => [title, severity, test.title, execution]),
          // The test was renamed earlier in this run.
          [["The policy is refused", "S2", "Show the detail of a policy", latest!.id]],
        );
        instance.executions = executions;
        await page.goBack();
        await page.getByRole("link", { name: /Voir le dernier résultat/ }).click();
        await page.waitForURL(/#\/executions\/result\?id=/);
      },
      instance.api,
    );
    for (const measured of [screen, relaunch]) {
      assert.ok(measured!.lines.length > 0, "the module is in the build");
      assert.deepEqual(measured!.uncovered, []);
    }
  });

  it("changes the title and a step of a test in a panel, the whole screen of a phone and a drawer on a wide one, and shows its code", async () => {
    const instance = new ListedInstance();
    const sources = ["src/tests/test-text-panel.tsx"];
    const measured = await app().measure(
      sources,
      async (page) => {
        await page.setViewportSize({ width: 390, height: 800 });
        await page.goto(`http://console.test/#/tests/view?path=${encodeURIComponent(DETAIL_TEST.path)}`);
        await page.getByText("Read its amounts", { exact: true }).waitFor();
        assert.equal(await overflowOf(page), 0, "the card fits a phone");
        assert.deepEqual(await tooSmallOf(page), [], "a finger reaches each action of the card");
        // The code of the test is folded until the person opens it.
        await page.getByText("Voir le code du test").click();
        await page.getByText('await expect(page.getByText("CHF 1,200.00")).toBeVisible();').waitFor();
        // On a phone, the panel of the title takes the whole screen; Enter saves the title, and the panel closes on the card read again.
        await page.getByRole("link", { name: "Modifier le titre" }).click();
        const dialog = page.getByRole("dialog", { name: "Titre du test" });
        await settled(dialog);
        assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width: 390, height: 800 });
        assert.deepEqual(await tooSmallOf(page), [], "a finger reaches each action of the panel");
        const field = dialog.getByLabel("Titre", { exact: true });
        assert.equal(await field.inputValue(), DETAIL_TEST.title);
        await field.fill("Show the detail of a policy");
        await field.press("Enter");
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("heading", { name: "Show the detail of a policy" }).waitFor();
        // A step is changed without the number the list gives it: an empty text is refused, and so is a change the instance refuses, once.
        await page.getByRole("link", { name: "Modifier l’étape 2" }).click();
        const step = page.getByRole("dialog", { name: "Étape 2" });
        const text = step.getByLabel("Ce que fait l’étape");
        assert.equal(await text.inputValue(), "Read its amounts");
        await text.fill("  ");
        await step.getByRole("button", { name: "Enregistrer" }).click();
        await step.getByText("Écrivez un texte.").waitFor();
        await text.fill("x".repeat(301));
        await step.getByRole("button", { name: "Enregistrer" }).click();
        await step.getByText("Le texte dépasse 300 caractères.").waitFor();
        await text.fill("Read the amounts\nof the policy");
        assert.equal(await text.inputValue(), "Read the amounts of the policy", "a step is one line");
        instance.changeRefusal = "test_change_refused";
        await step.getByRole("button", { name: "Enregistrer" }).click();
        await step.getByText("Ce changement ne peut pas être écrit").waitFor();
        await step.getByRole("button", { name: "Enregistrer" }).click();
        await step.waitFor({ state: "detached" });
        await page.getByText("Read the amounts of the policy", { exact: true }).waitFor();
        // On a wide screen, the panel is a drawer at the right, which Cancel closes without a change.
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.getByRole("link", { name: "Modifier l’étape 1" }).click();
        const first = page.getByRole("dialog", { name: "Étape 1" });
        await settled(first);
        const drawer = (await first.boundingBox())!;
        assert.ok(drawer.x > 720 && drawer.x + drawer.width === 1440 && drawer.height === 900, `the drawer is at ${JSON.stringify(drawer)}`);
        await first.getByRole("link", { name: "Annuler" }).click();
        await first.waitFor({ state: "detached" });
        assert.deepEqual(instance.changes, [
          { path: DETAIL_TEST.path, title: DETAIL_TEST.title, change: { title: "Show the detail of a policy" } },
          { path: DETAIL_TEST.path, title: "Show the detail of a policy", change: { step: 2, text: "Read the amounts of the policy" } },
        ]);
      },
      instance.api,
    );
    for (const [rank, source] of sources.entries()) {
      assert.ok(measured[rank]!.lines.length > 0, `${source} is in the build`);
      assert.deepEqual(measured[rank]!.uncovered, [], source);
    }
  });

  it("runs every line of the screen of a trace when it is used in the browser, from the result of a test, the menu folded", async () => {
    const [screen] = await app().measure(
      ["src/executions/trace-page.tsx"],
      async (page) => {
        await page.goto(`http://console.test/#/executions/result?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`);
        await page.getByRole("link", { name: /Voir la trace/ }).click();
        await page.waitForURL(/#\/executions\/trace\?id=/);
        await page.locator("iframe.trace-frame").waitFor();
        await page.locator(".shell.folded").waitFor();
      },
      new ListedInstance().api,
    );
    assert.ok(screen!.lines.length > 0, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the pages of the campaigns when they are used in the browser: plan one, fix its tests, launch them, close it", async () => {
    const instance = new ListedInstance();
    const [list, one] = await app().measure(
      ["src/campaigns/campaigns-page.tsx", "src/campaigns/campaign-page.tsx"],
      async (page) => {
        // The console speaks the language of the configuration it read first; the page of the campaigns then reads none.
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        instance.unconfigured = true;
        await page.evaluate(() => (window.location.hash = "#/campaigns"));
        await page.getByRole("link", { name: /Recette 4\.2/ }).waitFor();
        await page.getByRole("textbox", { name: "Nom" }).fill("Recette 4.3");
        await page.getByRole("textbox", { name: "Environnement" }).fill("local");
        await page.getByText("En dire plus").click();
        await page.getByLabel("Version visée").fill("4.3");
        await page.getByLabel("Dernier jour").fill("2026-12-05");
        instance.refusal = "invalid_request";
        await page.getByRole("button", { name: "Planifier" }).click();
        await page.getByRole("alert").waitFor();
        await page.getByRole("button", { name: "Planifier" }).click();
        await page.waitForURL(/#\/campaigns\/view\?id=c2/);
        // Its tests are chosen among those of the repository, narrowed, then kept: once refused, then taken.
        await page.getByRole("searchbox", { name: "Filtrer par mots" }).fill("zzz");
        await page.getByText("Aucun test ne correspond à ces filtres.").waitFor();
        await page.getByRole("searchbox", { name: "Filtrer par mots" }).fill("");
        await page.getByRole("button", { name: "Cocher les tests affichés", exact: true }).click();
        await page.getByRole("checkbox", { name: /Display the detail of a policy/ }).uncheck();
        await page.getByRole("checkbox", { name: /Display the detail of a policy/ }).check();
        instance.refusal = "campaign_refused";
        await page.getByRole("button", { name: /^Enregistrer la sélection/ }).click();
        await page.getByText("La campagne refuse ce changement").waitFor();
        await page.getByRole("button", { name: /^Enregistrer la sélection/ }).click();
        await page.getByText("Sélection enregistrée.").waitFor();
        await page.getByRole("button", { name: "Figer les tests" }).click();
        await page.getByRole("button", { name: "Lancer les tests" }).click();
        await page.getByText(/Lancement en cours : 1 \/ \d+ tests finis/).waitFor();
        // The launch ends: the campaign is read again.
        instance.launches = { last: { ...instance.launches.running!, endedAt: "2026-11-20T10:02:00.000Z", execution: "e1" } };
        await page.getByRole("button", { name: "Clôturer", exact: true }).click();
        await page.getByRole("button", { name: "Annuler" }).click();
        await page.getByRole("button", { name: "Tout relancer" }).click();
        await page.getByText(/Lancement en cours : 1 \/ \d+ tests finis/).waitFor();
        instance.launches = {};
        await page.getByRole("button", { name: "Clôturer", exact: true }).click();
        instance.refusal = "campaign_refused";
        await page.getByRole("button", { name: "Clôturer la campagne" }).click();
        await page.getByText("La campagne refuse ce changement").waitFor();
        await page.getByRole("button", { name: "Clôturer", exact: true }).click();
        await page.getByRole("button", { name: "Clôturer la campagne" }).click();
        await page.getByText("Clôturée le").waitFor();
        // Once the configuration is read again, the form offers the environments it declares.
        instance.unconfigured = false;
        await page.evaluate(() => (window.location.hash = "#/campaigns"));
        await page.locator('select[name="environment"]').waitFor();
      },
      instance.api,
    );
    assert.ok(list!.lines.length > 0 && one!.lines.length > 0, "the pages are in the build");
    assert.deepEqual([list!.uncovered, one!.uncovered], [[], []]);
  });

  it("lets the screens of the campaigns fit the width of a small phone", async () => {
    for (const hash of ["#/campaigns", "#/campaigns/view?id=c1"]) {
      const page = await app().open(360, hash, new ListedInstance().api);
      try {
        await page.locator(".campaign-row, .campaign-result").first().waitFor();
        assert.equal(await overflowOf(page), 0, hash);
      } finally {
        await page.close();
      }
    }
  });

  it("lets the screen of a trace fit the width of a small phone", async () => {
    const page = await app().open(360, `#/executions/trace?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`, new ListedInstance().api);
    try {
      await page.locator("iframe.trace-frame").waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("lets the card of a test, its tags, its steps, its versions and its executions, fit the width of a small phone", async () => {
    const instance = new ListedInstance();
    const since = "2026-11-19T10:00:05.000Z";
    instance.versions = [
      { path: DETAIL, title: "Policies › Display the detail of a policy with a long title", number: 12, digest: "d12", since, executions: 140 },
      {
        path: DETAIL,
        title: "Display the detail of a policy",
        number: 11,
        digest: "d11",
        commit: "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2",
        since,
        executions: 3,
      },
    ];
    const page = await app().open(360, `#/tests/view?path=${encodeURIComponent(DETAIL)}`, instance.api);
    try {
      await page.locator(".test-written").waitFor();
      await page.getByText("Version 12").waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("runs every line of the screen of a result when it is used in the browser, and shows the page at the step chosen", async () => {
    const [screen] = await app().measure(
      ["src/executions/result-page.tsx"],
      async (page) => {
        await page.goto(`http://console.test/#/executions/result?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`);
        await page.getByText("Échoue à l’étape 2 sur 2.").waitFor();
        // A step chosen in the list shows its page, and the address keeps it.
        await page.getByRole("link", { name: /Open the policy of the customer/ }).click();
        await page.waitForURL(/&step=1$/);
        await page.getByRole("img", { name: "Capture de l’étape 1" }).waitFor({ state: "attached" });
        // The arrows go from a step to the next, which takes the focus, and stay at the last and at the first.
        const entries = await page.evaluate(() => history.length);
        await page.keyboard.press("ArrowRight");
        await page.waitForURL(/&step=2$/);
        await page.locator(".test-step.on:focus", { hasText: "Read its amounts" }).waitFor();
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowLeft");
        await page.waitForURL(/&step=1$/);
        await page.locator(".test-step.on:focus", { hasText: "Open the policy of the customer" }).waitFor();
        assert.equal(await page.evaluate(() => history.length), entries, "the steps gone through leave one entry of the history");
      },
      new ListedInstance().api,
    );
    assert.ok(screen!.lines.length > 5, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("lets the screen of a result, its steps, its captures and its details, fit the width of a small phone", async () => {
    const page = await app().open(360, `#/executions/result?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`, new ListedInstance().api);
    try {
      await page.locator(".test-step").first().waitFor();
      await page.getByText("Détails techniques").click();
      assert.equal(await overflowOf(page), 0);
      // The page at a step takes the whole width of the card.
      await page.goto(`${page.url()}&step=1`);
      const capture = await page.getByRole("img", { name: "Capture de l’étape 1" }).boundingBox();
      assert.ok(capture !== null && capture.width > 300, JSON.stringify(capture));
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("lets the executions, a line unfolded into its tests, and the screen of one, fit the width of a small phone", async () => {
    const page = await app().open(360, "#/executions", new ListedInstance().api);
    try {
      await page.locator(".exec-row summary").first().click();
      await page.locator(".exec-tests .tests-row").first().waitFor();
      assert.equal(await overflowOf(page), 0);
      await page.goto(`http://console.test/#/executions/view?id=${EXECUTIONS[0]!.id}`);
      await page.locator(".tests-row").first().waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("shows the executions as a table on a wide screen, its heading on one line above the cells of each execution", async () => {
    const page = await app().open(1280, "#/executions", new ListedInstance().api);
    try {
      await page.locator(".exec-row summary").first().waitFor();
      // The cells of a line share a band: each starts above where every other ends.
      const boxes = async (line: string) =>
        Promise.all((await page.locator(`${line} > span, ${line} > a`).all()).map(async (cell) => (await cell.boundingBox())!));
      for (const line of [".exec-head", "details.exec-row:first-of-type > summary"]) {
        // The room of the toggle in the heading holds nothing, and has no height.
        const cells = (await boxes(line)).filter((cell) => cell.height > 0);
        assert.ok(
          cells.length >= 5 && Math.max(...cells.map((cell) => cell.y)) < Math.min(...cells.map((cell) => cell.y + cell.height)),
          `${line} ${JSON.stringify(cells)}`,
        );
      }
    } finally {
      await page.close();
    }
  });

  it("runs every line of the screens of the executions when they are used in the browser, from a page to an execution and to a result", async () => {
    const instance = new ListedInstance();
    const [list, one, followed, polled] = await app().measure(
      ["src/executions/executions-page.tsx", "src/executions/execution-page.tsx", "src/executions/launch-page.tsx", "src/api/use-polled.ts"],
      async (page) => {
        // An execution the instance does not keep is said so, in the words of the console.
        await page.goto("http://console.test/#/executions/view?id=gone");
        await page.getByText("L’instance ne garde plus cette exécution.").waitFor();
        await page.goto("http://console.test/#/executions");
        const outcome = page.getByLabel("Résultat");
        const period = page.getByLabel("Période");
        await outcome.selectOption("failing");
        await page.waitForURL(/#\/executions\?outcome=failing$/);
        await period.selectOption("week");
        await page.waitForURL(/#\/executions\?outcome=failing&period=week$/);
        await page.getByRole("link", { name: /Plus anciennes/ }).click();
        await page.waitForURL(/#\/executions\?outcome=failing&period=week&before=older$/);
        await page.getByRole("link", { name: /Les plus récentes/ }).waitFor();
        await page.getByLabel("Origine").selectOption("manual");
        await page.waitForURL(/#\/executions\?outcome=failing&origin=manual&period=week$/);
        await page.getByLabel("Origine").selectOption("");
        await page.waitForURL(/#\/executions\?outcome=failing&period=week$/);
        // Choosing a filter opens its first page; the first choice of a list keeps every execution.
        await outcome.selectOption("");
        await page.waitForURL(/#\/executions\?period=week$/);
        await period.selectOption("");
        await page.waitForURL(/#\/executions$/);
        await page.getByLabel(/^Campagne/).selectOption({ index: 1 });
        await page.waitForURL(/#\/executions\?campaign=/);
        await page.getByLabel(/^Campagne/).selectOption("");
        await page.getByLabel("Par page").selectOption("50");
        await page.waitForURL(/#\/executions\?size=50$/);
        await page.getByLabel("Par page").selectOption("");
        await page.waitForURL(/#\/executions$/);
        // The launch that runs is followed to the execution it kept, which opens in its place.
        const running = { startedAt: "2026-11-20T09:01:00.000Z", environment: "local", paths: [DETAIL] };
        instance.launches = { running };
        await page.getByRole("link", { name: /En cours/ }).click();
        await page.getByText("Exécution en cours depuis").waitFor();
        instance.launches = { last: { ...running, endedAt: "2026-11-20T09:02:00.000Z", execution: EXECUTIONS[0]!.id } };
        await page.waitForURL(`**/#/executions/view?id=${EXECUTIONS[0]!.id}`);
        await page.goto("http://console.test/#/executions");
        await page.locator(".exec-row summary").first().click();
        await page
          .getByRole("link", { name: /Ouvrir l’exécution/ })
          .first()
          .click();
        await page.waitForURL(/#\/executions\/view\?id=/);
        // A view shows its tests, and the address keeps it.
        await page.getByRole("link", { name: "Tous · 5" }).click();
        await page.waitForURL(/&view=all$/);
        await page.getByRole("link", { name: /Print a policy/ }).waitFor();
        // A search narrows them, and the address keeps it with the view.
        await page.getByRole("searchbox").fill("edit");
        await page.getByRole("searchbox").press("Enter");
        await page.waitForURL(/&view=all&q=edit$/);
        await page.getByRole("link", { name: /Edit a policy/ }).waitFor();
        // Its failures run again: a refusal is said, then the launch is followed to the execution it kept.
        instance.refusal = "launch_refused";
        await page.getByRole("button", { name: "Relancer l’échec" }).click();
        await page.getByText("Les tests ne peuvent pas être lancés maintenant").waitFor();
        await page.getByRole("button", { name: "Relancer l’échec" }).click();
        await page.getByText("Relance en cours").waitFor();
        assert.deepEqual(instance.launches.running!.paths, [DETAIL]);
        instance.launches = { last: { ...instance.launches.running!, endedAt: "2026-11-20T10:02:00.000Z", execution: EXECUTIONS[1]!.id } };
        await page.getByRole("link", { name: /Voir le résultat/ }).click();
        await page.waitForURL(`**/#/executions/view?id=${EXECUTIONS[1]!.id}`);
        await page.goBack();
        await page.getByRole("link", { name: /Policies › Edit a policy/ }).click();
        await page.waitForURL(/#\/executions\/result\?id=/);
      },
      instance.api,
    );
    for (const measured of [list, one, followed, polled]) {
      assert.ok(measured!.lines.length > 0, "the module is in the build");
      assert.deepEqual(measured!.uncovered, []);
    }
  });

  it("runs every line of the screen of the tests when it is used in the browser", async () => {
    const instance = new ListedInstance();
    const [screen] = await app().measure(
      ["src/tests/tests-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/tests?level=functional");
        await page.getByText("Display the detail of a policy").waitFor();
        await page.getByRole("searchbox", { name: "Chercher un titre, un chemin ou un tag" }).fill("  edit  ");
        await page.getByRole("searchbox", { name: "Chercher un titre, un chemin ou un tag" }).press("Enter");
        await page.waitForURL(/#\/tests\?level=functional&q=edit$/);
        // The search narrows the list: the test it does not match goes, the one it matches stays.
        await page.getByText("Display the detail of a policy").waitFor({ state: "detached" });
        await page.getByText("Compare the edit form of a policy").waitFor();
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the screens of the knowledge when they are used in the browser", async () => {
    const instance = new DocumentedInstance();
    const [screen, pages, panels] = await app().measure(
      ["src/knowledge/knowledge-page.tsx", "src/configuration/use-item-pages.ts", "src/configuration/use-panel-controls.ts"],
      async (page) => {
        await page.goto("http://console.test/#/knowledge/manuals?document=quotes.md");
        await page.getByText("A quote is priced.").waitFor();
        await page.getByLabel("Fichiers Markdown").setInputFiles([{ name: "claims.md", mimeType: "text/markdown", buffer: Buffer.from("# Claims\n") }]);
        await page.getByRole("button", { name: "Déposer", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "1 document déposé" }).waitFor();
        await page.getByRole("link", { name: "Retirer claims.md" }).click();
        await page.getByRole("button", { name: "Retirer le document" }).click();
        await page.getByRole("status").filter({ hasText: "Document retiré." }).waitFor();
        await page.waitForURL(/#\/knowledge\/manuals$/);
        // A source is added, tested and saved alone, then followed under the identifier it is saved with.
        await page.goto("http://console.test/#/knowledge");
        // The knowledge is mapped again on demand: a session that maps it already says so.
        await page.getByRole("button", { name: "Tout cartographier à nouveau" }).click();
        await page.getByRole("status").filter({ hasText: "Une session cartographie déjà les connaissances" }).waitFor();
        await page.getByRole("link", { name: "Ajouter une connaissance" }).click();
        await page.getByRole("button", { name: "Ajouter la documentation d’une API" }).click();
        await page.getByLabel("Identifiant", { exact: true }).fill("pricing");
        await page.getByLabel("Adresse du contrat").fill("http://127.0.0.1:3001/pricing.json");
        await page.getByLabel("Pour", { exact: true }).selectOption("applications");
        const dialog = page.getByRole("dialog");
        await page.getByRole("link", { name: /^Modifier Sert à/ }).click();
        await dialog.getByLabel("Application", { exact: true }).selectOption("shop");
        await page.keyboard.press("Escape");
        await page.waitForURL(/#\/knowledge\?add=source$/);
        await page.getByRole("button", { name: "Tester la connexion" }).click();
        await page.getByRole("status").filter({ hasText: "Connexion réussie · 3 éléments trouvés." }).waitFor();
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.waitForURL(/#\/knowledge\/pricing$/);
        // An attachment is added in a panel, which its removal closes, as dropping the change does; Escape closes the panel of another.
        await page.getByRole("button", { name: "Ajouter un rattachement" }).click();
        await page.waitForURL(/#\/knowledge\/pricing\?panel=attachment%3A1$/);
        await dialog.getByRole("button", { name: "Retirer ce rattachement" }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Ajouter un rattachement" }).click();
        await dialog.getByLabel("Application", { exact: true }).selectOption("shop");
        await dialog.getByRole("button", { name: "Annuler les modifications" }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("link", { name: "Modifier Sert à : Shop, tous les environnements" }).click();
        await dialog.getByLabel("Environnement", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.waitForURL(/#\/knowledge\/pricing$/);
        // An attachment saved from its panel closes it.
        await page.getByRole("button", { name: "Ajouter un rattachement" }).click();
        await dialog.getByLabel("Application", { exact: true }).selectOption("shop");
        await dialog.getByLabel("Environnement", { exact: true }).selectOption("local");
        await dialog.getByRole("button", { name: "Enregistrer" }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("link", { name: "Modifier Sert à : Shop, local" }).waitFor();
        await page.getByLabel("Identifiant", { exact: true }).fill("prices");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.waitForURL(/#\/knowledge\/prices$/);
        assert.deepEqual(
          instance.configured.saved.map(({ document }) => document.knowledge.at(-1)?.id),
          ["pricing", "pricing", "prices"],
        );
        // A source removed once the person confirmed it leads back to the knowledge.
        await page.getByRole("link", { name: "Retirer la source" }).click();
        await page.getByRole("button", { name: "Retirer la source" }).click();
        await page.waitForURL(/#\/knowledge$/);
        assert.equal(instance.configured.saved.at(-1)?.document.knowledge.length, 8);
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
    assert.deepEqual(pages!.uncovered, []);
    assert.deepEqual(panels!.uncovered, []);
  });

  it("criterion 3 — tests an address from the panel of an environment, the wait then what it found told, on a phone and on a wide screen", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, "#/applications/shop?panel=environment%3A0", new ConfiguredInstance().api);
      try {
        const dialog = page.getByRole("dialog");
        await dialog.getByLabel("Adresse de l’interface").fill("http://127.0.0.1:1/");
        await dialog.getByRole("button", { name: "Tester http://127.0.0.1:1/" }).click();
        await dialog.getByRole("status").filter({ hasText: "La connexion est refusée" }).waitFor();
        assert.equal(await overflowOf(page), 0, `${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("runs every line of the screens of the applications when they are used in the browser", async () => {
    const instance = new ConfiguredInstance();
    const [screen, panel, panels] = await app().measure(
      ["src/applications/applications-page.tsx", "src/ui/side-panel.tsx", "src/configuration/use-panel-controls.ts"],
      async (page) => {
        await page.goto("http://console.test/#/applications");
        // An application is added on a page of its own and saved alone, followed under the identifier it is saved with, then removed.
        await page.getByRole("link", { name: "Ajouter une application" }).click();
        // The identifier of an application added follows its name.
        await page.getByLabel("Nom", { exact: true }).first().fill("Back office");
        await page.getByLabel("Ce qu’elle expose").selectOption("web");
        // An environment is added in a panel, which its removal closes; Escape closes the panel of another.
        const dialog = page.getByRole("dialog");
        await page.getByRole("button", { name: "Ajouter un environnement" }).click();
        await page.waitForURL(/#\/applications\?add=application&panel=environment%3A1$/);
        await dialog.getByRole("button", { name: "Retirer cet environnement" }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("link", { name: "Modifier Environnement 1" }).click();
        await dialog.getByLabel("Nom", { exact: true }).waitFor();
        await page.keyboard.press("Escape");
        await page.waitForURL(/#\/applications\?add=application$/);
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.waitForURL(/#\/applications\/back-office$/);
        // A test account added and then dropped closes its panel; one saved from its panel closes it too.
        await page.getByRole("button", { name: "Ajouter un compte" }).click();
        await dialog.getByLabel("Nom du compte").fill("tester");
        await dialog.getByRole("button", { name: "Annuler les modifications" }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Ajouter un compte" }).click();
        await dialog.getByLabel("Nom du compte").fill("tester");
        await dialog.getByRole("button", { name: "Enregistrer" }).click();
        await dialog.waitFor({ state: "detached" });
        await page.getByRole("link", { name: "Modifier tester" }).waitFor();
        // The identifier of an application in force is set under « Avancé ».
        await page.getByText("Avancé", { exact: true }).first().click();
        await page.getByLabel("Identifiant", { exact: true }).fill("office");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.waitForURL(/#\/applications\/office$/);
        assert.deepEqual(
          instance.saved.slice(-3).map(({ document }) => document.applications.at(-1)?.id),
          ["back-office", "back-office", "office"],
        );
        await page.getByRole("link", { name: "Retirer l’application" }).click();
        await page.getByRole("button", { name: "Retirer l’application" }).click();
        await page.waitForURL(/#\/applications$/);
        assert.equal(instance.saved.at(-1)?.document.applications.length, 1);
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
    assert.deepEqual(panel!.uncovered, []);
    assert.deepEqual(panels!.uncovered, []);
  });

  it("runs every line of the screen of the configuration when it is used in the browser", async () => {
    const instance = new ConfiguredInstance();
    const [screen, editor] = await app().measure(
      ["src/configuration/configuration-page.tsx", "src/configuration/use-configuration-editor.ts"],
      async (page) => {
        await page.goto("http://console.test/#/configuration");
        await page.getByRole("heading", { name: "Agents", exact: true }).waitFor();
        // The settings of an expert are folded: those of the model, then those of the autonomy.
        await page
          .locator("details", { has: page.getByLabel("Attente d’une réponse, en secondes") })
          .locator("summary")
          .click();
        await page.getByLabel("Attente d’une réponse, en secondes").fill("90");
        await page.getByRole("button", { name: "Tester la connexion" }).last().click();
        await page.getByRole("status").filter({ hasText: "Choisissez un modèle dans la liste" }).waitFor();
        await page.getByLabel("Connexion au modèle").selectOption("Autre serveur (adresse à saisir)");
        await page.getByLabel("Connexion au modèle").selectOption("Compte GitHub de cette machine (Copilot)");
        await page.getByLabel(/^Autonome/).check();
        await page.getByLabel("Entre applications").check();
        await page.getByRole("button", { name: "Annuler les modifications" }).click();
        await page.getByRole("button", { name: "Enregistrer" }).waitFor({ state: "detached" });
        await page.getByLabel("Modèle", { exact: true }).fill("saved-model");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 3 enregistrée" }).waitFor();
        // A change saved writes no file: the file is written, or taken, when the person asks for it, under the history folded.
        await page.getByRole("heading", { name: "Historique et copies des réglages" }).click();
        await page.getByRole("button", { name: "Écrire oqas.json" }).click();
        await page.getByText("oqas.json contient la révision en vigueur.").waitFor();
        await page.getByLabel("Modèle", { exact: true }).fill("kept-model");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 4 enregistrée" }).waitFor();
        await page.getByRole("button", { name: "Prendre oqas.json" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 5 enregistrée" }).waitFor();
        // What the team asks of an agent is written in its panel, which closes once it is saved.
        await page.getByRole("link", { name: "Modifier Rédacteur d’un test" }).click();
        await page.getByRole("dialog").getByLabel("Consignes de l’équipe").fill("Say policy.");
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByRole("status").filter({ hasText: "Révision 6 enregistrée" }).waitFor();
        // The whole prompt of an agent is replaced from a copy of its own, saved though it leaves a variable out, then given back.
        await page.getByRole("link", { name: "Modifier Rédacteur d’un test" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Remplacer tout le prompt" }).click();
        await page.getByRole("dialog").getByLabel("Prompt de l’équipe").fill("Write with {{run_tool}}.");
        await page.getByRole("dialog").getByRole("status").filter({ hasText: "Il manque {{propose_tool}}" }).waitFor();
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 7 enregistrée" }).waitFor();
        assert.deepEqual(instance.saved.at(-1)?.document.agents?.writer?.prompt, { text: "Write with {{run_tool}}.", basedOn: "b".repeat(64) });
        await page.getByRole("link", { name: "Modifier Rédacteur d’un test" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Revenir au prompt par défaut" }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 8 enregistrée" }).waitFor();
        assert.equal(instance.saved.at(-1)?.document.agents?.writer?.prompt, undefined);
        // A value typed is saved alone, out of the configuration, which does not change.
        await page.getByLabel("Clé", { exact: true }).fill("typed-key");
        await page.getByRole("button", { name: "Tester la connexion" }).last().click();
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("status").filter({ hasText: "Les valeurs tapées sont enregistrées sur cet ordinateur." }).waitFor();
        assert.equal(instance.values.get("MODEL_KEY"), "typed-key");
        assert.equal(instance.revisions[0]?.number, 8, "the configuration did not change");
        // An instance with no configuration yet is set up step by step, then its repository prepared.
        instance.view = { file: "missing" };
        instance.revisions = [];
        instance.fileChanged = false;
        // An instance that cannot give the prompts of the agents leaves them unread.
        instance.prompts = undefined;
        await page.goto("http://console.test/#/agent");
        // The screen of the configuration is left, and its draft with it, before it opens again.
        await page.getByRole("heading", { name: "Agents", exact: true }).waitFor({ state: "detached" });
        await page.goto("http://console.test/#/configuration");
        await page.getByRole("button", { name: "Commencer" }).click();
        for (const step of ["Vos applications", "Ce que les agents peuvent lire", "Le modèle"]) {
          await page.getByRole("heading", { name: step }).waitFor();
          if (step === "Vos applications") {
            // An address is tested as it is typed; changing it clears what the test found.
            await page.getByLabel("Adresse de l’interface").first().fill("http://shop.test/");
            await page.getByRole("button", { name: "Tester http://shop.test/" }).click();
            await page.getByRole("status").filter({ hasText: "Répond (200)." }).waitFor();
            await page.getByLabel("Adresse de l’interface").first().fill("http://shop.test/home");
            await page.getByRole("status").filter({ hasText: "Répond (200)." }).waitFor({ state: "detached" });
          }
          if (step === "Ce que les agents peuvent lire") {
            // A source is tested as it is drafted.
            await page.getByRole("button", { name: "Ajouter la documentation d’une API" }).click();
            await page.getByRole("button", { name: "Tester la connexion" }).click();
            await page.getByRole("status").filter({ hasText: "Connexion réussie · 3 éléments trouvés." }).waitFor();
          }
          await page.getByRole("button", { name: "Suivant" }).click();
        }
        await page.getByText("Ce dossier deviendra un dépôt git").waitFor();
        // A step left is found again as it was.
        await page.getByRole("button", { name: "Retour" }).click();
        await page.getByRole("heading", { name: "Le modèle" }).waitFor();
        await page.getByRole("button", { name: "Suivant" }).click();
        await page.getByRole("button", { name: "Créer le projet" }).click();
        await page.getByText("Le projet est prêt").waitFor();
        assert.equal(instance.saved.at(-1)?.document.language, "fr", "the configuration speaks the language it was set up in");
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
    assert.deepEqual(editor!.uncovered, []);
  });
});
