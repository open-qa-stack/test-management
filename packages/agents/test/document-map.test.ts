import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { DocumentSet, documentTools } from "@open-qa-stack/tools";
import { Journal } from "../src/common/journal.ts";
import { documentCartographerInstructions, documentMapRequest } from "../src/document-cartographer/document-cartographer-prompt.ts";
import { DocumentMap } from "../src/document-cartographer/document-map.ts";
import { DocumentWatch } from "../src/document-cartographer/document-watch.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-document-map-"));
after(() => rmSync(workspace, { recursive: true, force: true }));

const FILES: Readonly<Record<string, string>> = {
  "orders/place.md": "# Place an order\n\nA customer places an order.\n\n## Limits\n\nTen lines at most.\n\n## Limits\n\nOne address.\n",
  "orders/cancel.md": `# Cancel an order\n\n${"Before it ships. ".repeat(30)}\n`,
  "orders/follow.md": "# Follow an order\n",
  "billing/invoice.md": "# Invoice\n\nSent by email, with the token s3cr3t-token.\n",
  "changelog.md": "# Changes\n",
  "glossary.md": "No heading here.\n",
};

type Told = string | { error: string };

/** A map of the documents above, with the tools an agent explores them with and those it hands its map in with. */
async function mapped(files: readonly string[] = Object.keys(FILES), path = "docs", texts: Readonly<Record<string, string>> = FILES) {
  const root = mkdtempSync(join(workspace, "repo-"));
  for (const path of files) {
    mkdirSync(join(root, "docs", path, ".."), { recursive: true });
    writeFileSync(join(root, "docs", path), texts[path]!);
  }
  const documents = new DocumentSet(root, path);
  const listing = await documents.list();
  const watch = new DocumentWatch(listing.files.map((file) => file.path));
  const journal = new Journal();
  const sections = new Map(await Promise.all(listing.files.map(async ({ path }) => [path, await documents.sections(path)] as const)));
  const map = new DocumentMap({ sourceId: "specs", documents, files: listing.files, sections, watch, secrets: ["s3cr3t-token"], journal });
  const explore = watch.watched(documentTools("specs", documents));
  const call = (name: string, args: object = {}) => [...explore, ...map.tools()].find((tool) => tool.name === name)!.execute(args) as Promise<Told>;
  return { map, journal, call, watch };
}

const ORDERS = { id: "orders", label: "Orders", description: "Placing, following and cancelling an order." };
const refusal = (what: string, ...problems: string[]) => ({
  error: [`Refused. ${what}. Fix what follows, and only that, then call the tool again.`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
});
const left = (count: number, names: string) =>
  `${count} documents or sections are in no domain and not set aside: ${names}. Next: place each with write_domain, or set it aside with set_aside; a section that holds others covers them.`;

describe("what an agent saw of the documents of a source", () => {
  it("is what its calls showed: the title of a document a listing returns, its outline, its text, and nothing for a call that fails", async () => {
    const { call, watch } = await mapped();
    assert.equal(watch.saw("changelog.md", "titled"), false);
    await call("specs_list_files");
    // The listing of the root shows its documents, not those of its folders.
    assert.deepEqual(
      [watch.saw("changelog.md", "titled"), watch.saw("changelog.md", "outlined"), watch.saw("orders/place.md", "titled")],
      [true, false, false],
    );
    await call("specs_list_sections", { file: "orders/place.md" });
    assert.deepEqual(
      [watch.saw("orders/place.md", "titled"), watch.saw("orders/place.md", "outlined"), watch.saw("orders/place.md", "read")],
      [true, true, false],
    );
    await call("specs_read_section", { file: "orders/place.md", number: 1 });
    assert.equal(watch.saw("orders/place.md", "read"), true);
    // A listing after a read takes nothing back, a section that does not exist shows nothing, and a search names no document.
    await call("specs_list_files", { folder: "orders" });
    assert.equal(watch.saw("orders/place.md", "read"), true);
    await call("specs_read_section", { file: "orders/cancel.md", number: 9 });
    await call("specs_search", { text: "order" });
    assert.equal(watch.saw("orders/cancel.md", "outlined"), false);
    // A source of one document: a call that names none is about it.
    const one = await mapped(["changelog.md"], "docs/changelog.md");
    await one.call("specs_read_file");
    assert.equal(one.watch.saw("changelog.md", "read"), true);
  });
});

describe("the request of the agent that maps the documents of a source", () => {
  it("gives what the root holds: its folders with how many documents each holds, and its documents with their title and their size, forty at most", () => {
    const file = (path: string, title?: string) => ({ path, ...(title === undefined ? {} : { title }), headings: 2, chars: 100 });
    assert.equal(
      documentMapRequest("specs", [file("guide.md")]),
      "Map the 1 document of the source specs.\n\nDocuments of its root:\n- guide.md (2 headings, 100 characters)\n\nNext: walk the tree, get an idea of each document, then hand each domain in with write_domain.",
    );
    assert.equal(
      documentMapRequest("specs", [file("orders/a.md", "A"), file("orders/b.md"), file("billing/c.md")]).split("\n\n")[1],
      "Folders of its root:\n- orders/ (2 documents)\n- billing/ (1 documents)",
    );
    const many = documentMapRequest(
      "shop-specs",
      Array.from({ length: 42 }, (_, at) => file(`d${at}.md`, `D${at}`)),
    );
    assert.match(many, /\n- d39\.md — D39 \(2 headings, 100 characters\)\n- … and 2 more: list them with shop_specs_list_files\.\n\nNext: /);
    assert.doesNotMatch(documentCartographerInstructions("specs"), /[ \t]$/m);
  });
});

describe("the map of the documents of a source, handed in domain by domain", () => {
  it("refuses a domain, an element or a body the source and what the agent looked at do not bear, saying what to do, and keeps a domain whole or not at all", async () => {
    const { map, call, journal } = await mapped();
    await call("specs_list_files");
    await call("specs_list_sections", { file: "orders/cancel.md" });
    const elements = [
      { file: "orders/place.md", section: 2, role: "The limits of an order." },
      { file: "ghost.md", role: "Nothing." },
      { file: "orders/cancel.md", role: " " },
      { file: "orders/cancel.md", role: "x".repeat(201) },
    ];
    assert.deepEqual(
      await call("write_domain", { id: "Orders!", description: "x".repeat(201), elements, body: "x" }),
      refusal(
        "The domain Orders! was not kept",
        'The domain id "Orders!" is not a slug. Write lower case letters and digits separated by hyphens, such as "order-returns".',
        "Give the label of the domain on one line of 200 characters at most.",
        "Give the description of the domain on one line of 200 characters at most.",
        "You looked at nothing of orders/place.md but its title. Call specs_list_sections or specs_read_file on it before you place it.",
        "ghost.md is no document of specs. Use the paths specs_list_files gives.",
        "Give the role of orders/cancel.md on one line of 200 characters at most.",
        "Give the role of orders/cancel.md on one line of 200 characters at most.",
      ),
    );
    assert.deepEqual(
      await call("write_domain", { ...ORDERS, elements: "none", body: "x" }),
      refusal("The domain orders was not kept", "The domain has no element. Give its documents, or their sections, in elements."),
    );
    await call("specs_list_sections", { file: "orders/place.md" });
    const cancel = { file: "orders/cancel.md", role: "How an order is cancelled." };
    assert.deepEqual(
      await call("write_domain", { ...ORDERS, elements: [{ file: "orders/place.md", section: 9, role: "r" }, cancel, cancel], body: "x" }),
      refusal(
        "The domain orders was not kept",
        "orders/place.md has no section 9. Give a number specs_list_sections returns for it, or leave section out for the whole document.",
        "orders/cancel.md is given twice. Give each element once.",
      ),
    );
    // A call without a body gives an empty one, refused as such.
    assert.deepEqual(
      await call("write_domain", { ...ORDERS, elements: [cancel] }),
      refusal("The file of the domain orders was not kept", "The answer is empty. Write the markdown body of the file."),
    );
    const many = Array.from({ length: 41 }, () => cancel);
    assert.match(
      ((await call("write_domain", { ...ORDERS, elements: many, body: "x" })) as { error: string }).error,
      /- The domain has 41 elements, 40 at most\. Split it into two domains\./,
    );
    assert.deepEqual([map.closed, map.reminder()?.startsWith("You stopped before the end. 6 documents or sections are in no domain")], [false, true]);
    assert.ok(journal.entries().some((entry) => entry.message === "The domain orders was not kept: orders/cancel.md is given twice. Give each element once."));
  });

  it("names a section by its document and its title, keeps a domain with its file, replaces it when handed in again, and holds an element to one domain", async () => {
    const { map, call } = await mapped();
    await call("specs_list_sections", { file: "orders/place.md" });
    await call("specs_read_file", { file: "orders/cancel.md" });
    const elements = [
      { file: "orders/place.md", role: "How an order is placed." },
      { file: "orders/place.md", section: 2, role: "How many lines." },
      { file: "orders/place.md", section: 3, role: "How many addresses." },
      { file: "orders/cancel.md", role: "When an order may be cancelled." },
    ];
    // The body names each element between backticks: a section by its document and its title, with its number when the title comes back.
    const named = ["orders/place.md", "orders/place.md § Limits (§2)", "orders/place.md § Limits (§3)", "orders/cancel.md"];
    assert.deepEqual(
      await call("write_domain", { ...ORDERS, elements, body: "`orders/place.md` and orders/cancel.md." }),
      refusal(
        "The file of the domain orders was not kept",
        "orders/cancel.md is named, but not between backticks. Proposed: `orders/cancel.md`, where you name it.",
        "These elements of the domain are not named: orders/place.md § Limits (§2), orders/place.md § Limits (§3). Name each exactly as written, between backticks, such as `orders/place.md § Limits (§2)`.",
      ),
    );
    const body = named.map((name) => `- \`${name}\``).join("\n");
    assert.equal(
      await call("write_domain", { ...ORDERS, elements, body: `\`\`\`md\n${body}\n\`\`\`` }),
      `The domain orders is kept with 4 elements. ${left(4, "billing/invoice.md, changelog.md, glossary.md, orders/follow.md")}`,
    );
    await call("specs_read_file", { file: "billing/invoice.md" });
    assert.deepEqual(
      await call("write_domain", {
        id: "billing",
        label: "Billing",
        description: "Invoices.",
        elements: [elements[3], { file: "billing/invoice.md", role: "r" }],
        body: "x",
      }),
      refusal("The domain billing was not kept", "orders/cancel.md is already in the domain orders. Place an element in one domain."),
    );
    // Handed in again, the domain is replaced: the document it no longer holds is in no domain again.
    assert.equal(
      await call("write_domain", { ...ORDERS, elements: elements.slice(0, 1), body: "`orders/place.md` says how." }),
      `The domain orders is kept with 1 elements. ${left(5, "billing/invoice.md, changelog.md, glossary.md, orders/cancel.md, orders/follow.md")}`,
    );
    const { exported, grouping, files } = await map.result();
    assert.deepEqual(
      exported.elements.map((element) => [element.name, element.kind, grouping.state(element.name)]),
      [
        ["orders/place.md", "document", { domain: "orders", role: "How an order is placed." }],
        ...["billing/invoice.md", "changelog.md", "glossary.md", "orders/cancel.md", "orders/follow.md"].map((name) => [
          name,
          "document",
          { unplaced: "The session of the agent ended before it was placed or set aside." },
        ]),
      ],
    );
    assert.deepEqual(
      [...files].map(([id, file]) => [id, file.body, file.writtenBy]),
      [["orders", "`orders/place.md` says how.", "model"]],
    );
    assert.equal(
      exported.elements[0]!.summary,
      "document orders/place.md\n  starts: A customer places an order. ## Limits Ten lines at most. ## Limits One address.",
    );
    assert.equal(exported.elements[3]!.summary, "document glossary.md");
  });

  it("sets aside the documents the agent saw, with why, and holds a document to a domain or to the side", async () => {
    const { map, call } = await mapped();
    await call("specs_list_files");
    await call("specs_read_file", { file: "orders/cancel.md" });
    await call("write_domain", { ...ORDERS, elements: [{ file: "orders/cancel.md", role: "r" }], body: "`orders/cancel.md`" });
    assert.deepEqual(
      await call("set_aside", { elements: [{ file: "orders/cancel.md" }, { file: "ghost.md" }, { file: "orders/follow.md" }], reason: " " }),
      refusal(
        "Nothing was set aside",
        "orders/cancel.md is in the domain orders: a document or a section is placed or set aside, not both.",
        "ghost.md is no document of specs. Use the paths specs_list_files gives.",
        "You saw nothing of orders/follow.md. List its folder with specs_list_files before you set it aside.",
        "Give the reason in one sentence of 200 characters at most.",
      ),
    );
    assert.deepEqual(
      await call("set_aside", { elements: "none", reason: "r" }),
      refusal("Nothing was set aside", "Give in elements the documents, or the sections, to set aside."),
    );
    assert.deepEqual(
      await call("set_aside", { elements: [{ file: "changelog.md" }], reason: "x".repeat(201) }),
      refusal("Nothing was set aside", "Give the reason in one sentence of 200 characters at most."),
    );
    assert.equal(
      await call("set_aside", { elements: [{ file: "changelog.md" }, { file: "glossary.md" }], reason: "They  describe\nno feature." }),
      `2 documents or sections are set aside. ${left(3, "billing/invoice.md, orders/follow.md, orders/place.md")}`,
    );
    await call("specs_list_sections", { file: "changelog.md" });
    assert.deepEqual(
      await call("write_domain", { id: "history", label: "History", description: "Changes.", elements: [{ file: "changelog.md", role: "r" }], body: "x" }),
      refusal("The domain history was not kept", "changelog.md is set aside: a document or a section is placed or set aside, not both."),
    );
    const { exported, grouping } = await map.result();
    assert.deepEqual(grouping.state("changelog.md"), { dismissed: "They describe no feature." });
    // The summary of an element gives the start of its text, cut when long.
    assert.match(
      exported.elements.find((element) => element.name === "orders/cancel.md")!.summary,
      /^document orders\/cancel\.md\n  starts: (Before it ships\. ){17}Before it s…$/,
    );
    assert.equal(exported.elements.find((element) => element.name === "changelog.md")!.definition, "# Changes\n");
  });

  it("holds a document cut into sections to every one of them: a section is covered by itself or by one that holds it, and the largest left are named", async () => {
    const spec = [
      "# Spec",
      "",
      "Intro.",
      "",
      "## Orders",
      "",
      "### Place",
      "",
      "A.",
      "",
      "### Cancel",
      "",
      "B.",
      "",
      "## Customers",
      "",
      "C.",
      "",
      "## Glossary",
      "",
      "D.",
      "",
    ].join("\n");
    const { map, call } = await mapped(["spec.md", "notes.md"], "docs", { "spec.md": spec, "notes.md": "# Notes\n\n## Glossary\n" });
    await call("specs_list_files");
    await call("specs_read_file", { file: "spec.md" });
    const orders = (section: number) => ({ ...ORDERS, elements: [{ file: "spec.md", section, role: "An order." }] });
    // One section placed does not cover its document: the sections beside it, and those beside the ones that hold it, are still to place.
    assert.equal(
      await call("write_domain", { ...orders(3), body: "`spec.md § Place`" }),
      `The domain orders is kept with 1 elements. ${left(4, "notes.md, spec.md § Cancel (section 4), spec.md § Customers (section 5), spec.md § Glossary (section 6)")}`,
    );
    // A section is set aside as a document is, once its outline was seen; one placed is not.
    assert.deepEqual(
      await call("set_aside", {
        elements: [
          { file: "spec.md", section: 3 },
          { file: "spec.md", section: 9 },
          { file: "notes.md", section: 2 },
        ],
        reason: "Words.",
      }),
      refusal(
        "Nothing was set aside",
        "spec.md § Place is in the domain orders: a document or a section is placed or set aside, not both.",
        "spec.md has no section 9. Give a number specs_list_sections returns for it, or leave section out for the whole document.",
        "You saw nothing of notes.md § Glossary. List the sections of notes.md with specs_list_sections before you set it aside.",
      ),
    );
    assert.equal(
      await call("set_aside", { elements: [{ file: "spec.md", section: 6 }, { file: "notes.md" }], reason: "Words, not features." }),
      `2 documents or sections are set aside. ${left(2, "spec.md § Cancel (section 4), spec.md § Customers (section 5)")}`,
    );
    assert.deepEqual(
      await call("write_domain", { id: "words", label: "Words", description: "Words.", elements: [{ file: "spec.md", section: 6, role: "r" }], body: "x" }),
      refusal("The domain words was not kept", "spec.md § Glossary is set aside: a document or a section is placed or set aside, not both."),
    );
    // A section that holds others covers them: the chapter of the orders, handed in instead of one of its sections.
    assert.equal(
      await call("write_domain", { ...orders(2), body: "`spec.md § Orders`" }),
      `The domain orders is kept with 1 elements. ${left(1, "spec.md § Customers (section 5)")}`,
    );
    assert.equal(map.closed, false);
    const customers = {
      id: "customers",
      label: "Customers",
      description: "Customers.",
      elements: [{ file: "spec.md", section: 5, role: "A customer." }],
      body: "`spec.md § Customers`",
    };
    assert.equal(
      await call("write_domain", customers),
      "The domain customers is kept with 1 elements. The whole source is placed or set aside. Answer with one sentence; call no more tools.",
    );
    const { exported, grouping } = await map.result();
    assert.deepEqual(
      exported.elements.map((element) => [element.name, element.kind, element.definition, grouping.state(element.name)]),
      [
        ["spec.md § Orders", "section", "## Orders\n\n### Place\n\nA.\n\n### Cancel\n\nB.", { domain: "orders", role: "An order." }],
        ["spec.md § Customers", "section", "## Customers\n\nC.", { domain: "customers", role: "A customer." }],
        ["spec.md § Glossary", "section", "## Glossary\n\nD.", { dismissed: "Words, not features." }],
        ["notes.md", "document", "# Notes\n\n## Glossary\n", { dismissed: "Words, not features." }],
      ],
    );
    // A section left when the session ends is an element all the same, unplaced.
    const cut = await mapped(["spec.md"], "docs", { "spec.md": spec });
    await cut.call("specs_list_sections", { file: "spec.md" });
    await cut.call("write_domain", { ...orders(2), body: "`spec.md § Orders`" });
    const ended = await cut.map.result();
    assert.deepEqual(
      ended.exported.elements.slice(1).map((element) => [element.name, ended.grouping.state(element.name)]),
      ["spec.md § Customers", "spec.md § Glossary"].map((name) => [name, { unplaced: "The session of the agent ended before it was placed or set aside." }]),
    );
  });

  it("asks once whether titles told enough when few documents of a domain were read, writes itself the file refused three times, and masks a secret", async () => {
    const { map, call, journal } = await mapped();
    for (const file of ["orders/place.md", "orders/cancel.md", "orders/follow.md"]) await call("specs_list_sections", { file });
    const elements = ["orders/place.md", "orders/cancel.md", "orders/follow.md"].map((file) => ({ file, role: "An order." }));
    const body = elements.map((element) => `\`${element.file}\``).join(", ");
    const warning = (await call("write_domain", { ...ORDERS, elements, body })) as string;
    assert.match(
      warning,
      /^Warning: the domain orders is not kept yet\. You read the text of 0 of its 3 documents, and only the titles of the others\. Read those whose titles do not tell what they state, with specs_read_file or specs_read_section; if the titles tell enough, call write_domain again with the same domain to confirm\.$/,
    );
    // The same call again confirms, and is not asked twice.
    assert.equal(
      await call("write_domain", { ...ORDERS, elements, body }),
      `The domain orders is kept with 3 elements. ${left(3, "billing/invoice.md, changelog.md, glossary.md")}`,
    );
    // With the text of one document in three read, nothing is asked.
    const enough = await mapped();
    for (const file of ["orders/place.md", "orders/cancel.md"]) await enough.call("specs_list_sections", { file });
    await enough.call("specs_read_file", { file: "orders/follow.md" });
    assert.match((await enough.call("write_domain", { ...ORDERS, elements, body })) as string, /^The domain orders is kept with 3 elements\./);
    // A body that holds a secret is refused, masked; the third one refused is written by the harness, and the domain kept.
    await call("specs_read_file", { file: "billing/invoice.md" });
    const billing = { id: "billing", label: "Billing", description: "Invoices.", elements: [{ file: "billing/invoice.md", role: "How an invoice is sent." }] };
    const leaky = "`billing/invoice.md` uses s3cr3t-token.";
    const told = refusal("The file of the domain billing was not kept", "The body holds a secret of the configuration. Write it without the secret.");
    assert.deepEqual([await call("write_domain", { ...billing, body: leaky }), await call("write_domain", { ...billing, body: leaky })], [told, told]);
    assert.equal(
      await call("write_domain", { ...billing, body: leaky }),
      `The domain billing is kept with 1 elements, its file written by the harness. ${left(2, "changelog.md, glossary.md")}`,
    );
    const { files } = await map.result();
    const { body: written, writtenBy, refused, refusedBody } = files.get("billing")!;
    assert.deepEqual(
      [written, writtenBy, refused, refusedBody],
      [
        "| Element | Kind | Role |\n|---|---|---|\n| `billing/invoice.md` | document | How an invoice is sent. |",
        "harness",
        "The body holds a secret of the configuration. Write it without the secret.",
        leaky,
      ],
    );
    assert.ok(journal.entries().every((entry) => !entry.message.includes("s3cr3t-token")));
    assert.ok(journal.entries().some((entry) => entry.message === "2 documents or sections were left in no domain: changelog.md, glossary.md."));
  });

  it("is over once every document is placed or set aside, and closed by the harness after ten calls refused: what is placed stays", async () => {
    const done = await mapped(["changelog.md"], "docs/changelog.md");
    await done.call("specs_read_file");
    assert.equal(
      await done.call("write_domain", {
        id: "history",
        label: "History",
        description: "Changes.",
        elements: [{ file: "changelog.md", role: "r" }],
        body: "`changelog.md`",
      }),
      "The domain history is kept with 1 elements. The whole source is placed or set aside. Answer with one sentence; call no more tools.",
    );
    const over = { error: "The map is closed: what is placed stays, and the rest will be asked again later. Answer with one sentence; call no more tools." };
    assert.deepEqual(
      [done.map.closed, done.map.reminder(), await done.call("write_domain", {}), await done.call("set_aside", {})],
      [true, undefined, over, over],
    );
    const { map, call, journal } = await mapped();
    const answers: Told[] = [];
    for (let at = 0; at < 10; at += 1) answers.push(await call("set_aside", { elements: [{ file: "ghost.md" }], reason: "r" }));
    assert.deepEqual([answers[9], map.closed, map.reminder()], [over, true, undefined]);
    assert.equal(journal.entries().at(-1)!.message, "The map of specs was closed after 10 calls refused.");
    // Past twenty documents left, a result names the first twenty.
    const many = mkdtempSync(join(workspace, "many-"));
    mkdirSync(join(many, "docs"));
    for (let at = 10; at < 32; at += 1) writeFileSync(join(many, "docs", `d${at}.md`), `# D${at}\n`);
    const documents = new DocumentSet(many, "docs");
    const listing = await documents.list();
    const watch = new DocumentWatch(listing.files.map((file) => file.path));
    const large = new DocumentMap({ sourceId: "specs", documents, files: listing.files, sections: new Map(), watch, secrets: [], journal: new Journal() });
    assert.match(large.reminder()!, /22 documents or sections are in no domain and not set aside: d10\.md, .*, d29\.md, and 2 more\. Next: /);
  });
});
