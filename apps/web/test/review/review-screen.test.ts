import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";
import type { PolledState } from "../../src/api/polled-state.ts";
import { nameApplications } from "../../src/applications/application-names.ts";
import { reviewHref, reviewPlaceOf } from "../../src/review/review-paths.ts";
import { ReviewScreen, type ReviewControls } from "../../src/review/review-screen.tsx";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { ASIDE, POLICY, PROPOSAL, QUEUE, QUOTE } from "./review-fixture.ts";

/** The screen of an address, with what the instance told of the queue and of the test shown, as HTML. */
const screen = (hash: string, queue: PolledState<ReviewQueue> = { value: QUEUE }, proposal?: PolledState<TestProposal>, controls?: ReviewControls): string =>
  render(
    createElement(ReviewScreen, {
      project: "lakeside-tests",
      route: parseRoute(hash),
      place: reviewPlaceOf(parseRoute(hash)),
      queue,
      ...(proposal === undefined ? {} : { proposal }),
      ...(controls === undefined ? {} : { controls }),
    }),
  );

/** What the person does on the screen, which a static rendering never calls. */
const CONTROLS: ReviewControls = {
  validate: () => assert.fail("nothing is validated"),
  setAside: () => assert.fail("nothing is set aside"),
  restore: () => assert.fail("nothing is put back in review"),
  correct: () => assert.fail("no correction is asked"),
  pending: false,
};

describe("the place of the review in the address", () => {
  it("is the view of the new tests, every domain and the first test by default, and is written back the same", () => {
    assert.deepEqual(reviewPlaceOf(parseRoute("#/review")), { view: "new" });
    assert.deepEqual(reviewPlaceOf(parseRoute("#/review?view=elsewhere&domain=&id=")), { view: "new" });
    const place = reviewPlaceOf(parseRoute(`#/review?view=set_aside&domain=quotes&id=${ASIDE.id}`));
    assert.deepEqual(place, { view: "set_aside", domain: "quotes", id: ASIDE.id });
    assert.equal(reviewHref(place), `#/review?view=set_aside&domain=quotes&id=${ASIDE.id}`);
    assert.equal(reviewHref({ view: "new" }), "#/review");
  });
});

describe("the review of the tests the agents wrote", () => {
  it("says it reads the queue until the instance told it, and why it could not", () => {
    assert.equal(
      textOf(screen("#/review", {})),
      "lakeside-tests / À relire À relire Lecture des tests à relire Ils apparaissent dès que l’instance a répondu.",
    );
    assert.match(textOf(screen("#/review", { unread: "L’instance ne répond pas." })), /Lecture des tests à relire L’instance ne répond pas\.$/);
    // Once told, the queue stays shown while the instance does not answer, with why.
    assert.match(textOf(screen("#/review", { value: QUEUE, unread: "L’instance ne répond pas." })), /sans vous\. L’instance ne répond pas\. Nouveaux tests 2/);
  });

  it("lists the views with their counts and the tests to review, the first one shown on its card, and the keys that go through them", () => {
    nameApplications([{ id: "policy-management", name: "Policy Management" }]);
    const html = screen("#/review", { value: QUEUE }, { value: PROPOSAL });
    nameApplications([]);
    const text = textOf(html);
    assert.match(
      text,
      /^lakeside-tests \/ À relire À relire Les tests que les agents ont écrits attendent votre décision : rien n’entre dans le dépôt sans vous\. /,
    );
    assert.match(text, /Nouveaux tests 2 Mises à jour 0 Écartés 1 Tous les domaines quotes policies /);
    assert.match(
      text,
      / A quote expires after thirty days Policy Management › quotes · Fonctionnel · joué ✔ · relu ✔ Edit the dates of a policy Policy Management › policies · Fonctionnel · joué ✗ · non relu Suivant : J · précédent : K /,
    );
    assert.match(text, / 1 \/ 2 Suivant › À relire Fonctionnel relu ✔ joué ✔ A quote expires after thirty days Policy Management › quotes › quote-expiry /);
    assert.match(
      text,
      / Pourquoi ce test IA Verify that a quote older than thirty days shows as expired\. Demandé : The expiry of the quotes\. Sources : policy-specs — Quotes, policy-management /,
    );
    assert.match(text, / Ce que le test vérifie Open the quotes The quotes show Open the quote of 1 October It shows Expired Its price is no longer shown /);
    assert.match(text, / Avis des relecteurs Code, line 12 : Use a role in place of the text\. PW-LOC-01 /);
    assert.match(
      text,
      / Code — apps\/policy-management\/tests\/quotes\/quote-expiry\/quote-expiry\.spec\.ts \(\+42\) · apps\/policy-management\/pages\/quotes-page\.ts \(\+6\) /,
    );
    assert.match(text, / 3 essais · Its last run passed\. Écarter Demander une correction Valider$/);
    assert.deepEqual(linksOf(html).slice(0, 4), ["#/review", "#/review?view=updates", "#/review?view=set_aside", "#/review"]);
    assert.ok(linksOf(html).includes(`#/review?id=${POLICY.id}`));
    // The code is folded, the gestures shown and inactive until the console can make them.
    assert.match(html, /<details class="review-section review-code"><summary>/);
    assert.equal(html.match(/<button type="button" class="btn[^"]*" disabled=""/g)?.length, 3);
    assert.match(html, /aria-current="true"[^>]*>|<a class="row review-row on"/);
  });

  it("shows the test the address names, says it reads it until told, and goes back to the first for one no longer listed", () => {
    const named = textOf(screen(`#/review?id=${POLICY.id}`, { value: QUEUE }, {}));
    assert.match(named, /‹ Précédent 2 \/ 2 Lecture du test…$/);
    assert.match(
      textOf(screen(`#/review?id=${POLICY.id}`, { value: QUEUE }, { unread: "Aucun test écrit par les agents ne porte plus cet identifiant." })),
      /2 \/ 2 Aucun test écrit/,
    );
    assert.match(textOf(screen("#/review?id=gone", { value: QUEUE }, {})), / 1 \/ 2 Suivant › Lecture du test…$/);
  });

  it("narrows the tests to a domain, and says when none of the view is of it", () => {
    const narrowed = screen("#/review?domain=policies", { value: QUEUE }, {});
    assert.match(textOf(narrowed), /Tous les domaines quotes policies Edit the dates of a policy .* 1 \/ 1 Lecture du test…$/);
    assert.ok(linksOf(narrowed).includes(`#/review?domain=policies&id=${POLICY.id}`));
    assert.match(
      textOf(screen("#/review?view=set_aside&domain=policies")),
      /Aucun résultat pour ces filtres Aucun test de ce domaine dans cette vue\. Effacer les filtres$/,
    );
    assert.ok(linksOf(screen("#/review?view=set_aside&domain=policies")).includes("#/review?view=set_aside"));
  });

  it("lists the tests set aside, each card with why, and says when none is", () => {
    const aside = {
      ...PROPOSAL,
      ...ASIDE,
      decision: { id: ASIDE.id, status: "set_aside", at: "2026-11-27T10:00:00.000Z", reason: "covered", coveredBy: "apps/x.spec.ts", note: "Same steps." },
    } as const;
    const text = textOf(screen("#/review?view=set_aside", { value: QUEUE }, { value: aside }));
    assert.match(text, /Écartés 1 List the quotes /);
    assert.match(
      text,
      / Écarté Fonctionnel relu ✔ joué ✔ List the quotes policy-management › quotes › quote-expiry Écarté : déjà couvert — apps\/x\.spec\.ts · Same steps\. Pourquoi/,
    );
    const bare = { ...aside, decision: { id: ASIDE.id, status: "set_aside", at: "2026-11-27T10:00:00.000Z", reason: "wrong_level" } } as const;
    assert.match(textOf(screen("#/review?view=set_aside", { value: QUEUE }, { value: bare })), / Écarté : pas au bon niveau Pourquoi/);
    // A test set aside is put back in review, and is neither validated nor set aside again.
    const gestures = screen("#/review?view=set_aside", { value: QUEUE }, { value: aside }, CONTROLS);
    assert.match(gestures, /<div class="review-actions"><button type="button" class="btn">Remettre en relecture<\/button><\/div><\/footer>/);
    assert.doesNotMatch(gestures, /Valider/);
    assert.match(screen("#/review?view=set_aside", { value: QUEUE }, { value: aside }), /<button type="button" class="btn" disabled="">Remettre en relecture</);
    const pending = screen("#/review?view=set_aside", { value: QUEUE }, { value: aside }, { ...CONTROLS, pending: true, refusal: "No." });
    assert.match(textOf(pending), /No\. Remise en relecture…$/);
    const none = { tests: [QUOTE], counts: { inReview: 1, setAside: 0 } };
    assert.match(textOf(screen("#/review?view=set_aside", { value: none })), /Aucun test écarté Les tests que vous écartez restent consultables ici\.$/);
  });

  it("says when every test is reviewed, with a session to start, and that the updates are still to come", () => {
    const reviewed = screen("#/review", { value: { tests: [ASIDE], counts: { inReview: 0, setAside: 1 } } });
    assert.match(textOf(reviewed), /Tout est relu Aucun test n’attend votre décision\. .* Démarrer une session$/);
    assert.ok(linksOf(reviewed).includes("#/agent"));
    assert.match(textOf(screen("#/review?view=updates")), /Aucune mise à jour Les mises à jour de tests proposées par les agents apparaîtront ici\.$/);
  });

  it("tells a visual test, and a test no agent reviewed, which has no remark", () => {
    const { brief: _, ...withoutBrief }: TestProposal = { ...PROPOSAL, ...POLICY, remarks: [] };
    const text = textOf(screen(`#/review?id=${POLICY.id}`, { value: QUEUE }, { value: withoutBrief }));
    assert.match(text, / À relire Fonctionnel Visuel non relu joué ✗ Edit the dates of a policy /);
    assert.match(text, / Avis des relecteurs Aucun agent ne l’a relu\. /);
    assert.doesNotMatch(text, /Demandé :/);
    const coherent = { ...PROPOSAL, remarks: [{ about: "coherence", where: "step 2", what: "It does not check the price." }] } as TestProposal;
    assert.match(
      textOf(screen("#/review", { value: QUEUE }, { value: coherent })),
      / Avis des relecteurs Cohérence, step 2 : It does not check the price\. Code —/,
    );
    const quiet = { ...PROPOSAL, remarks: [] } as TestProposal;
    assert.match(textOf(screen("#/review", { value: QUEUE }, { value: quiet })), / Avis des relecteurs Aucune remarque des agents qui l’ont relu\. /);
    const bare = { ...PROPOSAL, steps: [{ action: "Open the quotes", expects: [] }], files: [] } as TestProposal;
    assert.match(textOf(screen("#/review", { value: QUEUE }, { value: bare })), / Ce que le test vérifie Open the quotes Avis/);
  });

  it("gives the gestures of a test to review, opens the panel that sets it aside, and tells what came of a decision", () => {
    const html = screen("#/review", { value: QUEUE }, { value: PROPOSAL }, CONTROLS);
    // Set aside and ask for a correction open their panels, validate is a button.
    assert.ok(linksOf(html).includes("#/review?panel=set-aside"));
    assert.match(html, /<button type="button" class="btn primary" aria-keyshortcuts="V">Valider<\/button>/);
    assert.match(html, /<a class="btn" href="#\/review\?panel=correct" aria-keyshortcuts="C">Demander une correction<\/a>/);
    const panel = textOf(screen("#/review?panel=set-aside", { value: QUEUE }, { value: PROPOSAL }, CONTROLS));
    assert.match(
      panel,
      /Écarter « A quote expires after thirty days » Pourquoi l’écarter Déjà couvert par un autre test Hors périmètre Oracle incorrect : il ne vérifie pas ce qu’il faut Pas au bon niveau de la pyramide Le test qui le couvre déjà Son chemin dans le dépôt, si vous l’écartez comme déjà couvert\. Précision Réversible : le test reste consultable dans « Écartés »\. Annuler Écarter ce test$/,
    );
    // Under way, the gestures wait; refused, they say why; kept, the screen says what came of it.
    const pending = screen("#/review?panel=set-aside", { value: QUEUE }, { value: PROPOSAL }, { ...CONTROLS, pending: true });
    assert.match(pending, /<button type="button" class="btn primary" disabled="" aria-keyshortcuts="V">Validation…<\/button>/);
    assert.match(pending, /<button type="submit" form="review-set-aside" class="btn primary" disabled="">/);
    const refused = { ...CONTROLS, refusal: "Ce test ne peut pas entrer dans le dépôt maintenant." };
    assert.match(
      textOf(screen("#/review", { value: QUEUE }, { value: PROPOSAL }, refused)),
      / Ce test ne peut pas entrer dans le dépôt maintenant\. Écarter Demander une correction Valider$/,
    );
    assert.match(textOf(screen("#/review", { value: QUEUE }, { value: PROPOSAL }, { ...CONTROLS, told: "Écarté." })), /sans vous\. Écarté\. Nouveaux tests/);
    // Without what makes them, the panel cannot be submitted; a test set aside has no gesture, and opens no panel.
    assert.match(
      screen("#/review?panel=set-aside", { value: QUEUE }, { value: PROPOSAL }),
      /<button type="submit" form="review-set-aside" class="btn primary" disabled="">/,
    );
    const aside = { ...PROPOSAL, status: "set_aside" } as const;
    const set = textOf(screen("#/review?panel=set-aside", { value: QUEUE }, { value: aside }, CONTROLS));
    assert.doesNotMatch(set, /Valider|Pourquoi l’écarter/);
    assert.match(
      screen("#/review", { value: QUEUE }, { value: PROPOSAL }, { ...CONTROLS, pending: true }),
      /<button type="button" class="btn" disabled="" aria-keyshortcuts="C">/,
    );
  });

  it("asks for the correction of a test in its panel, with starters, and shows a test in correction, and what was asked of one", () => {
    const panel = screen("#/review?panel=correct", { value: QUEUE }, { value: PROPOSAL }, CONTROLS);
    assert.match(
      textOf(panel),
      /Demander une correction · A quote expires after thirty days Dites à l’agent ce qu’il faut changer\. .* Consigne Par exemple : .* \+ changer l’oracle de données \+ ajouter un cas limite \+ renommer le test Mémoriser comme consigne Gardée dans la Mémoire pour la conception des tests de cette application, modifiable ensuite\. La session repart dans ses garde-fous habituels\. Annuler Envoyer au concepteur$/,
    );
    assert.match(panel, /<textarea id="review-instruction" name="instruction" maxLength="2000" rows="5" required=""/);
    assert.match(
      screen("#/review?panel=correct", { value: QUEUE }, { value: PROPOSAL }),
      /<button type="submit" form="review-correct" class="btn primary" disabled="">/,
    );
    assert.match(
      screen("#/review?panel=correct", { value: QUEUE }, { value: PROPOSAL }, { ...CONTROLS, pending: true }),
      /<button type="submit" form="review-correct" class="btn primary" disabled="">Envoi…<\/button>/,
    );
    const decision = { id: PROPOSAL.id, status: "in_correction", at: "2026-11-27T10:00:00.000Z", instruction: "Use Max.", session: "s1" } as const;
    const correcting = { ...PROPOSAL, status: "in_correction", decision } as const;
    const queue = { ...QUEUE, tests: QUEUE.tests.map((test) => (test.id === PROPOSAL.id ? { ...test, status: "in_correction" as const } : test)) };
    const shown = screen("#/review?panel=correct", { value: queue }, { value: correcting }, CONTROLS);
    // A test in correction stays among the new tests, without gestures nor panel, and leads to the session that corrects it.
    assert.match(textOf(shown), / · En correction /);
    assert.match(textOf(shown), / En correction Fonctionnel .* Correction demandée : « Use Max\. » Suivre la correction Pourquoi/);
    assert.ok(linksOf(shown).includes("#/agent/sessions/s1"));
    assert.doesNotMatch(textOf(shown), /Valider|Consigne/);
    // Back in review, it keeps what was asked.
    assert.match(
      textOf(screen("#/review", { value: QUEUE }, { value: { ...PROPOSAL, decision } }, CONTROLS)),
      /Correction demandée : « Use Max\. » Lire la session/,
    );
  });
});
