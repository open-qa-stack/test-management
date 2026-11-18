import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import { KnowledgeScreen, whereOf, type KnowledgeControls } from "../../src/knowledge/knowledge-screen.tsx";
import { INITIAL_KNOWLEDGE, knowledgeAfter, type KnowledgeAction, type KnowledgeState } from "../../src/knowledge/knowledge-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { DOCUMENT, VIEW } from "../configuration/configuration-fixture.ts";

/** What the person does on the screens, which a static rendering never calls. */
const CONTROLS: KnowledgeControls = { upload: () => assert.fail("nothing is uploaded"), remove: () => assert.fail("nothing is removed") };

/** A document of the source `manuals` of the fixtures. */
const QUOTES = { name: "quotes.md", bytes: 1200, uploadedAt: "2026-11-18T09:00:00.000Z" };

/** The state after the actions, from the state once the instance told the configuration of the fixtures and the documents of `manuals`. */
const stateAfter = (actions: readonly KnowledgeAction[] = []): KnowledgeState =>
  [{ type: "read", view: VIEW } as const, { type: "listed", source: "manuals", items: [QUOTES] } as const, ...actions].reduce(
    knowledgeAfter,
    INITIAL_KNOWLEDGE,
  );

/** The screen of an address in a state, as HTML. */
const screen = (hash: string, state: KnowledgeState = stateAfter()): string =>
  render(createElement(KnowledgeScreen, { project: "shop-tests", route: parseRoute(hash), state, controls: CONTROLS }));

describe("the knowledge of the project", () => {
  it("says it reads the knowledge until the instance told it, and why it could not", () => {
    assert.equal(
      textOf(screen("#/knowledge", INITIAL_KNOWLEDGE)),
      "shop-tests / Connaissances Connaissances Déclarer dans la configuration Lecture des connaissances Elles apparaissent dès que l’instance a répondu.",
    );
    assert.match(
      textOf(screen("#/knowledge", { ...INITIAL_KNOWLEDGE, unread: "L’instance ne répond pas." })),
      /Lecture des connaissances L’instance ne répond pas\.$/,
    );
  });

  it("says the configuration declares no source, and leads to it", () => {
    const html = screen("#/knowledge", knowledgeAfter(INITIAL_KNOWLEDGE, { type: "read", view: { file: "missing" } }));
    assert.match(
      textOf(html),
      /Aucune source de connaissance Déclarez dans la configuration les contrats, les bases, les documents, le code et les journaux que lisent les agents\. Déclarer dans la configuration$/,
    );
    assert.deepEqual(linksOf(html), ["#/configuration", "#/configuration"]);
  });

  it("lists the sources of each application, where each is read from, never a secret, and how many documents the instance keeps", () => {
    const configuration = { ...DOCUMENT, applications: [...DOCUMENT.applications, { ...DOCUMENT.applications[0]!, id: "back-office", name: "Back office" }] };
    const html = screen(
      "#/knowledge",
      knowledgeAfter(stateAfter(), { type: "read", view: { ...VIEW, revision: { ...VIEW.revision!, document: configuration } } }),
    );
    const text = textOf(html);
    assert.match(
      text,
      /Les domaines qu’en tire la cartographie viendront dans une prochaine version\. Shop · shop contract Contrat OpenAPI · http:\/\/127\.0\.0\.1:3001\/openapi\.json local › backend local-contract/,
    );
    for (const row of [
      "orders Base PostgreSQL · variable SHOP_DB_URL",
      "specs Documents du dépôt · specs/orders.md",
      "manuals Documents déposés 1 document",
      "code Code source · ../shop",
      "server-log Journaux · logs/server.log",
      "container-log Journaux · conteneur shop",
    ])
      assert.ok(text.includes(row), row);
    assert.match(text, /Back office · back-office Aucune source n’est rattachée à cette application$/);
    assert.deepEqual(
      linksOf(html).filter((link) => link.startsWith("#/knowledge/")),
      [
        "#/knowledge/contract",
        "#/knowledge/local-contract",
        "#/knowledge/orders",
        "#/knowledge/specs",
        "#/knowledge/manuals",
        "#/knowledge/code",
        "#/knowledge/server-log",
        "#/knowledge/container-log",
      ],
    );
  });

  it("says where a source is read from by its kind", () => {
    assert.deepEqual(DOCUMENT.knowledge.map(whereOf), [
      "http://127.0.0.1:3001/openapi.json",
      "specs/openapi.yaml",
      "variable SHOP_DB_URL",
      "specs/orders.md",
      undefined,
      "../shop",
      "logs/server.log",
      "conteneur shop",
    ]);
  });
});

describe("a source of the knowledge", () => {
  it("says what it is and what it is attached to, and that the agents read it where it is", () => {
    const text = textOf(screen("#/knowledge/contract"));
    assert.equal(
      text,
      "shop-tests / Connaissances / contract contract Contrat OpenAPI · http://127.0.0.1:3001/openapi.json Les agents lisent cette source là où elle est : rien ne s’y dépose. shop local › backend",
    );
  });

  it("says the configuration declares no source of that name, once it is read", () => {
    assert.match(
      textOf(screen("#/knowledge/gone")),
      /Aucune source de ce nom La configuration en vigueur n’en déclare aucune : elle a pu être renommée ou retirée\. Revenir aux connaissances$/,
    );
    assert.match(textOf(screen("#/knowledge/gone", INITIAL_KNOWLEDGE)), /Lecture des connaissances Elles apparaissent dès que l’instance a répondu\. Revenir/);
    assert.match(textOf(screen("#/knowledge/gone", { ...INITIAL_KNOWLEDGE, unread: "Down." })), /Lecture des connaissances Down\. Revenir/);
  });

  it("lists the documents the instance keeps, each to read or to remove, and the form of an upload, which names its rules", () => {
    const html = screen("#/knowledge/manuals");
    const text = textOf(html);
    assert.match(
      text,
      /manuals Documents déposés Ses documents sont gardés par l’instance : une session les écrit là où ses agents les lisent\. Seul le Markdown est lu\. shop tous les environnements/,
    );
    assert.match(text, /Documents · dans l’ordre de leurs noms quotes\.md 1,2 ko · 18\/11\/2026 \d\d:00 Retirer/);
    assert.ok(linksOf(html).includes("#/knowledge/manuals?document=quotes.md"));
    assert.match(html, /<a class="btn sm ghost" href="#\/knowledge\/manuals\?remove=quotes.md" aria-label="Retirer quotes.md">Retirer<\/a>/);
    assert.match(text, /Déposer des documents Fichiers Markdown 1 Mo au plus chacun, 20 au plus à la fois\. Un document du même nom est remplacé\. Déposer$/);
    assert.match(
      html,
      /<input id="knowledge-files" type="file" multiple="" accept=".md,.markdown,text\/markdown" aria-invalid="false" aria-describedby="knowledge-files-hint" name="documents"\/>/,
    );
    assert.match(html, /<form class="config-body" data-source="manuals" noValidate="">/);
  });

  it("says it lists the documents until the instance did, and when there is none", () => {
    const unlisted = knowledgeAfter(INITIAL_KNOWLEDGE, { type: "read", view: VIEW });
    assert.match(textOf(screen("#/knowledge/manuals", unlisted)), /Documents · dans l’ordre de leurs noms Liste des documents Déposer des documents/);
    const empty = knowledgeAfter(unlisted, { type: "listed", source: "manuals", items: [] });
    assert.match(textOf(screen("#/knowledge/manuals", empty)), /Aucun document pour l’instant Déposez les premiers ci-dessous\./);
  });

  it("asks before it removes a document, and offers to cancel, for a document the source holds only", () => {
    const html = screen("#/knowledge/manuals?remove=quotes.md");
    assert.match(
      textOf(html),
      /Retirer quotes\.md \? Le document est supprimé de l’instance, et les prochaines sessions ne le lisent plus\. C’est définitif\. Annuler Retirer le document/,
    );
    assert.match(
      html,
      /<a class="btn" href="#\/knowledge\/manuals">Annuler<\/a><button type="button" class="btn danger" data-source="manuals" data-name="quotes.md">Retirer le document<\/button>/,
    );
    assert.doesNotMatch(textOf(screen("#/knowledge/manuals?remove=gone.md")), /Retirer gone\.md \?/);
  });

  it("says an upload or a removal is on its way, holds its button meanwhile, then says it was taken", () => {
    const sending = screen("#/knowledge/manuals?remove=quotes.md", stateAfter([{ type: "sending", source: "manuals" }]));
    assert.match(textOf(sending), /Envoi… Déposer des documents .* Envoi…$/);
    assert.match(sending, /data-name="quotes.md" disabled="">Retirer le document/);
    assert.match(sending, /<button type="submit" class="btn primary" disabled="">Envoi…<\/button>/);
    const uploaded = (count: number) =>
      textOf(screen("#/knowledge/manuals", stateAfter([{ type: "changed", source: "manuals", items: [QUOTES], uploaded: count }])));
    assert.match(uploaded(1), /1 document déposé : les prochaines sessions le lisent\./);
    assert.match(uploaded(2), /2 documents déposés : les prochaines sessions les lisent\./);
    assert.match(uploaded(0), /Document retiré\./);
    assert.doesNotMatch(textOf(screen("#/knowledge/manuals", stateAfter([{ type: "sending", source: "other" }]))), /Envoi…/);
  });

  it("says why an upload was refused, each error beside the file it is about, which the field points to", () => {
    const refusal = {
      code: "invalid_documents",
      text: "Les documents sont refusés.",
      names: ["quotes.md", "quotes.pdf"],
      errors: [
        { kind: "structure", path: "/documents/1", rule: "document-format", message: "Markdown only." },
        { kind: "structure", path: "/documents/7", rule: "document-size", message: "Too large." },
        { kind: "structure", path: "", rule: "too-many-documents", message: "Too many." },
      ],
    } as const;
    const html = screen("#/knowledge/manuals", stateAfter([{ type: "refused", source: "manuals", refusal }]));
    assert.match(
      textOf(html),
      /Les documents sont refusés\. quotes\.pdf Seul le Markdown est lu : un fichier qui finit par \.md ou \.markdown\. Trop lourd : un document fait 1 Mo au plus\. Trop de fichiers à la fois\. Déposer des documents/,
    );
    assert.match(html, /<section class="config-note ko" role="alert">/);
    assert.match(html, /aria-invalid="true" aria-describedby="knowledge-files-hint knowledge-files-errors"/);
    const removal = screen(
      "#/knowledge/manuals",
      stateAfter([{ type: "refused", source: "manuals", refusal: { code: "unknown_document", text: "Plus là.", errors: [], names: [] } }]),
    );
    assert.match(textOf(removal), /Retirer Plus là\. Déposer des documents/);
    assert.match(removal, /aria-invalid="false"/);
  });

  it("shows the text of the document the address names, as the instance keeps it, or why it could not read it", () => {
    const reading = textOf(screen("#/knowledge/manuals?document=quotes.md"));
    assert.match(reading, /quotes\.md · tel que l’instance le garde Fermer Lecture du document Il apparaît dès que l’instance a répondu\.$/);
    const opened = screen("#/knowledge/manuals?document=quotes.md", stateAfter([{ type: "opened", document: { ...QUOTES, text: "# Devis\n\n<b>gras</b>" } }]));
    assert.match(opened, /<pre class="mono knowledge-text"># Devis\n\n&lt;b&gt;gras&lt;\/b&gt;<\/pre>/);
    assert.ok(linksOf(opened).includes("#/knowledge/manuals"));
    const other = screen("#/knowledge/manuals?document=claims.md", stateAfter([{ type: "opened", document: { ...QUOTES, text: "#" } }]));
    assert.match(textOf(other), /Lecture du document/);
    const failed = screen("#/knowledge/manuals?document=gone.md", stateAfter([{ type: "unopened", source: "manuals", name: "gone.md", message: "Plus là." }]));
    assert.match(failed, /<span role="alert">Plus là\.<\/span>/);
    const elsewhere = screen("#/knowledge/manuals?document=gone.md", stateAfter([{ type: "unopened", source: "other", name: "gone.md", message: "Plus là." }]));
    assert.match(elsewhere, /<span role="status">Il apparaît/);
    assert.doesNotMatch(textOf(screen("#/knowledge/orders?document=quotes.md")), /Lecture du document/);
  });
});
