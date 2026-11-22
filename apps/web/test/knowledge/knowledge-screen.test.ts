import assert from "node:assert/strict";
import { createElement } from "react";
import { describe, it } from "vitest";
import type { CartographyState } from "@open-qa-stack/domain/sessions";
import { KnowledgeScreen, whereOf, type KnowledgeControls } from "../../src/knowledge/knowledge-screen.tsx";
import { INITIAL_KNOWLEDGE, knowledgeAfter, type KnowledgeAction, type KnowledgeState } from "../../src/knowledge/knowledge-state.ts";
import { parseRoute } from "../../src/routing/route.ts";
import { linksOf, render, textOf } from "../render.ts";
import { DOCUMENT, REVISIONS, VIEW } from "../configuration/configuration-fixture.ts";
import { configurationAfter, INITIAL_CONFIGURATION, type ConfigurationState } from "../../src/configuration/configuration-state.ts";
import { UNCALLED_CONTROLS } from "../configuration/uncalled-controls.ts";

/** What the person does on the screens, which a static rendering never calls. */
const CONTROLS: KnowledgeControls = {
  upload: () => assert.fail("nothing is uploaded"),
  remove: () => assert.fail("nothing is removed"),
  drop: () => assert.fail("no source is removed"),
  edit: UNCALLED_CONTROLS,
};

/** The draft of the configuration once the instance told the configuration of the fixtures. */
const EDITING: ConfigurationState = configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: VIEW, revisions: REVISIONS });

/** A document of the source `manuals` of the fixtures. */
const QUOTES = { name: "quotes.md", bytes: 1200, uploadedAt: "2026-11-18T09:00:00.000Z" };

/** The state after the actions, from the state once the instance told the configuration of the fixtures and the documents of `manuals`. */
const stateAfter = (actions: readonly KnowledgeAction[] = []): KnowledgeState =>
  [{ type: "read", view: VIEW } as const, { type: "listed", source: "manuals", items: [QUOTES] } as const, ...actions].reduce(
    knowledgeAfter,
    INITIAL_KNOWLEDGE,
  );

/** The screen of an address in a state, as HTML. */
const screen = (hash: string, state: KnowledgeState = stateAfter(), editing: ConfigurationState = EDITING): string =>
  render(createElement(KnowledgeScreen, { project: "shop-tests", route: parseRoute(hash), state, editing, controls: CONTROLS }));

describe("the knowledge of the project", () => {
  it("says it reads the knowledge until the instance told it, and why it could not", () => {
    assert.equal(
      textOf(screen("#/knowledge", INITIAL_KNOWLEDGE, INITIAL_CONFIGURATION)),
      "shop-tests / Connaissances Connaissances Configurer le projet Lecture des connaissances Elles apparaissent dès que l’instance a répondu.",
    );
    assert.match(
      textOf(screen("#/knowledge", { ...INITIAL_KNOWLEDGE, unread: "L’instance ne répond pas." })),
      /Lecture des connaissances L’instance ne répond pas\.$/,
    );
  });

  it("leads an instance without a configuration to set it up, and offers to add the first source to one that declares none", () => {
    const unset = screen(
      "#/knowledge",
      knowledgeAfter(INITIAL_KNOWLEDGE, { type: "read", view: { file: "missing" } }),
      configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: { file: "missing" }, revisions: [] }),
    );
    assert.match(
      textOf(unset),
      /Aucune source de connaissance Ajoutez les contrats, les bases, les documents, le code et les journaux que lisent les agents\. Configurer le projet$/,
    );
    assert.deepEqual(linksOf(unset), ["#/configuration", "#/configuration"]);
    const none = { ...VIEW, revision: { ...VIEW.revision!, document: { ...DOCUMENT, knowledge: [] } } };
    const empty = screen(
      "#/knowledge",
      knowledgeAfter(INITIAL_KNOWLEDGE, { type: "read", view: none }),
      configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: none, revisions: REVISIONS }),
    );
    assert.deepEqual(linksOf(empty), ["#/knowledge?add=source", "#/knowledge?add=source"]);
    const adding = screen(
      "#/knowledge?add=source",
      knowledgeAfter(INITIAL_KNOWLEDGE, { type: "read", view: none }),
      configurationAfter(INITIAL_CONFIGURATION, { type: "read", view: none, revisions: REVISIONS }),
    );
    assert.deepEqual(linksOf(adding), ["#/knowledge?add=source"], "the empty state offers nothing more while a source is added");
  });

  it("offers each kind of source to add, then the source of the kind chosen, to fill in and save", () => {
    const kinds = screen("#/knowledge?add=source");
    assert.match(
      textOf(kinds),
      /Connaissances Ajouter une connaissance Ajouter une connaissance · choisissez ce que les agents liront Ajouter un contrat OpenAPI Ajouter une base PostgreSQL Ajouter des documents du dépôt Ajouter des documents déposés Ajouter du code source Ajouter des journaux Les sources/,
    );
    for (const kind of ["openapi", "postgresql", "document", "stored", "source-code", "logs"])
      assert.match(kinds, new RegExp(`data-add="/knowledge" data-item="${kind}"`), kind);
    const added = configurationAfter(EDITING, {
      type: "add",
      pointer: "/knowledge",
      item: { id: "", type: "openapi", url: "", attachments: [{ application: "" }] },
    });
    const html = screen("#/knowledge?add=source", stateAfter(), added);
    assert.match(textOf(html), /Ajouter une connaissance Source 9 · Contrat OpenAPI Retirer Identifiant/);
    assert.match(html, /data-remove="\/knowledge\/8"/);
    assert.doesNotMatch(screen("#/knowledge?add=source", stateAfter(), INITIAL_CONFIGURATION), /data-add=/);
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

  it("tells where the cartography of each source stands, and of the index that puts them together", () => {
    const at = "2026-11-22T09:00:00.000Z";
    const mapped = (mapping: CartographyState) => textOf(screen("#/knowledge", stateAfter([{ type: "mapped", mapping }])));
    const sources = [
      { id: "orders", type: "postgresql", state: "waiting" },
      { id: "specs", type: "document", state: "mapping" },
      { id: "code", type: "source-code", state: "mapped", mappedAt: at },
      { id: "contract", type: "openapi", state: "truncated", mappedAt: at },
    ] as const;
    const text = mapped({ environment: "local", sources });
    assert.match(text, /Rien n’est encore cartographié : chaque source ajoutée est cartographiée aussitôt/);
    for (const row of [
      "orders Base PostgreSQL · variable SHOP_DB_URL En attente de cartographie",
      "specs Documents du dépôt · specs/orders.md Cartographie en cours",
      "code Code source · ../shop Cartographiée",
      "local › backend Cartographiée en partie",
    ])
      assert.ok(text.includes(row), row);
    assert.ok(text.includes("manuals Documents déposés 1 document code"), "a source the cartography does not read has no badge");
    assert.match(
      mapped({ environment: "local", sources, index: { producedAt: at, status: "complete" } }),
      /Connaissances mises en commun par domaine le 22 nov\. 2026/,
    );
    assert.match(
      mapped({ environment: "local", sources, index: { producedAt: at, status: "truncated" } }),
      /, en partie : une limite a arrêté la cartographie\./,
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
    const text = textOf(screen("#/knowledge/contract", stateAfter(), INITIAL_CONFIGURATION));
    assert.equal(
      text,
      "shop-tests / Connaissances / contract contract Contrat OpenAPI · http://127.0.0.1:3001/openapi.json shop local › backend Les agents lisent cette source là où elle est : rien ne s’y dépose.",
    );
  });

  it("lists the sources of the whole project first, which every session reads, and says it of one", () => {
    const wide = {
      ...DOCUMENT,
      knowledge: [
        { id: "glossary", type: "document", path: "docs/glossary.md" } as const,
        { id: "notes", type: "document", stored: true } as const,
        ...DOCUMENT.knowledge,
      ],
    };
    const view = { ...VIEW, revision: { ...VIEW.revision!, document: wide } };
    const state = [{ type: "read", view } as const, { type: "listed", source: "notes", items: [QUOTES] } as const].reduce(knowledgeAfter, stateAfter());
    assert.match(
      textOf(screen("#/knowledge", state)),
      /Tout le projet · lue quelle que soit l’application testée glossary Documents du dépôt · docs\/glossary\.md notes Documents déposés 1 document Shop · shop/,
    );
    assert.match(
      textOf(screen("#/knowledge/glossary", state, INITIAL_CONFIGURATION)),
      /glossary Documents du dépôt · docs\/glossary\.md Tout le projet Les agents lisent/,
    );
  });

  it("lets the person change the source, test it and save it alone, or remove it once they confirmed it", () => {
    const html = screen("#/knowledge/contract");
    assert.match(textOf(html), /^shop-tests \/ Connaissances \/ contract contract Retirer la source contract · Contrat OpenAPI Identifiant/);
    assert.match(html, /<a class="btn ghost" href="#\/knowledge\/contract\?drop=source">Retirer la source<\/a>/);
    assert.match(html, /name="\/knowledge\/0\/url"/);
    assert.doesNotMatch(html, /name="\/knowledge\/1\//);
    const asked = screen("#/knowledge/contract?drop=source");
    assert.match(
      textOf(asked),
      /Retirer la source contract \? Les prochaines sessions ne la lisent plus\. Une nouvelle révision de la configuration est enregistrée : la précédente reste dans l’historique\. Annuler Retirer la source contract/,
    );
    assert.match(asked, /<button type="button" class="btn danger" data-rank="0">Retirer la source<\/button>/);
    assert.match(screen("#/knowledge/contract?drop=source", stateAfter(), configurationAfter(EDITING, { type: "saving" })), /data-rank="0" disabled="">/);
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
    const html = screen("#/knowledge/manuals", stateAfter(), INITIAL_CONFIGURATION);
    const text = textOf(html);
    assert.match(
      text,
      /manuals Documents déposés shop tous les environnements Ses documents sont gardés par l’instance : une session les écrit là où ses agents les lisent\. Seul le Markdown est lu\./,
    );
    assert.match(text, /Documents · dans l’ordre de leurs noms quotes\.md 1,2 ko · 18 nov\. 2026, \d\d:00 Retirer/);
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
