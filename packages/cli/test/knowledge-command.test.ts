import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import { MAX_DOCUMENT_BYTES } from "@open-qa-stack/domain";
import { DatabaseUrl, InstanceDatabase } from "@open-qa-stack/store";
import { fixtureConfig } from "@open-qa-stack/testing/fixture-repository";
import { parseArguments, soloCommand } from "../src/index.ts";
import { mappingLines, sourceLine } from "../src/solo/knowledge-lines.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-knowledge-command-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

/** The configuration of the test repositories: a source of each kind, `manuals` the one whose documents the instance keeps. */
const TEXT = fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/", {
  knowledge: [
    { id: "contract", type: "openapi", url: "http://127.0.0.1:9/openapi.json", attachments: [{ application: "shop", environment: "local", api: "backend" }] },
    { id: "local-contract", type: "openapi", path: "specs/openapi.json", attachments: [{ application: "shop" }] },
    { id: "shop-db", type: "postgresql", connectionStringEnv: "SHOP_DB_URL", attachments: [{ application: "shop", environment: "staging" }] },
    { id: "order-specs", type: "document", path: "specs/orders.md", attachments: [{ application: "shop" }] },
    { id: "manuals", type: "document", stored: true, attachments: [{ application: "shop" }] },
    { id: "code", type: "source-code", path: "../shop", attachments: [{ application: "shop" }] },
    { id: "server-log", type: "logs", path: "logs/server.log", attachments: [{ application: "shop" }] },
    { id: "container-log", type: "logs", container: "shop", engine: "podman", attachments: [{ application: "shop" }] },
  ],
});

/** A date as the store writes it. */
const DATE = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z";

/** A test repository that holds a configuration file, the database of its instance kept beside it, and how to run oqas in it. */
function repository(text = TEXT) {
  const root = mkdtempSync(join(workspace, "repo-"));
  writeFileSync(join(root, "oqas.json"), text);
  const database = join(workspace, `${root.split("/").at(-1)!}.db`);
  const env = { OQAS_DATABASE_URL: `sqlite:${database}` };
  const oqas = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await soloCommand(argv, {
      env,
      cwd: root,
      stdout: { write: (written: string) => (out += written) },
      stderr: { write: (written: string) => (err += written) },
    });
    return { code, out, err };
  };
  return { root, database, oqas };
}

describe("oqas knowledge", () => {
  it("lists the sources of the configuration in force, where each is read from and what it is attached to, never a secret", async () => {
    const { oqas } = repository();
    assert.deepEqual(await oqas("knowledge", "list"), { code: 0, out: "The configuration in force declares no knowledge source.\n", err: "" });
    await oqas("config", "import");
    assert.deepEqual(await oqas("knowledge", "list"), {
      code: 0,
      out: [
        "contract: OpenAPI contract, http://127.0.0.1:9/openapi.json; attached to shop > local > backend.",
        "local-contract: OpenAPI contract, specs/openapi.json; attached to shop.",
        "shop-db: PostgreSQL database, variable SHOP_DB_URL; attached to shop > staging.",
        "order-specs: documents of the repository, specs/orders.md; attached to shop.",
        "manuals: documents the instance keeps; attached to shop.",
        "  no document yet",
        "code: source code, ../shop; attached to shop.",
        "server-log: logs, logs/server.log; attached to shop.",
        "container-log: logs, container shop; attached to shop.",
        "",
      ].join("\n"),
      err: "",
    });
  });

  it("says a source attached to no application is for the whole project", () => {
    assert.equal(
      sourceLine({ id: "glossary", type: "document", path: "docs/glossary.md" }),
      "glossary: documents of the repository, docs/glossary.md; for the whole project.",
    );
  });

  it("uploads files as documents of a source the instance keeps, all of them or none, then lists them", async () => {
    const { root, oqas } = repository();
    await oqas("config", "import");
    writeFileSync(join(root, "quotes.md"), "# Quotes\n");
    writeFileSync(join(root, "claims.md"), "# Claims\n");
    const added = await oqas("knowledge", "add-document", "manuals", "quotes.md", "claims.md");
    assert.equal(added.code, 0, added.err);
    assert.match(
      added.out,
      new RegExp(`^2 documents were uploaded to manuals\\.\\n  claims\\.md, 9 bytes, uploaded on ${DATE}\\n  quotes\\.md, 9 bytes, uploaded on ${DATE}\\n$`),
    );
    const again = await oqas("knowledge", "add-document", "manuals", "quotes.md", "--output", "json");
    const told = JSON.parse(again.out) as { source: string; documents: { name: string }[] };
    assert.deepEqual([told.source, told.documents.map(({ name }) => name)], ["manuals", ["claims.md", "quotes.md"]]);
    assert.match((await oqas("knowledge", "add-document", "manuals", "quotes.md")).out, /^1 document was uploaded to manuals\./);
    const listed = JSON.parse((await oqas("knowledge", "list", "--output", "json")).out) as { sources: { id: string; documents?: unknown[] }[] };
    assert.deepEqual(
      listed.sources.map(({ id, documents }) => `${id} ${documents?.length ?? "-"}`),
      ["contract -", "local-contract -", "shop-db -", "order-specs -", "manuals 2", "code -", "server-log -", "container-log -"],
    );
    assert.deepEqual(JSON.parse((await repository().oqas("knowledge", "list", "--output", "json")).out), { sources: [] });
  });

  it("refuses an upload that breaks a rule, each error at its file, a source that keeps no document, and a file it cannot read", async () => {
    const { root, oqas } = repository();
    await oqas("config", "import");
    writeFileSync(join(root, "quotes.md"), "# Quotes\n");
    writeFileSync(join(root, "manual.pdf"), "%PDF");
    writeFileSync(join(root, "large.md"), "a".repeat(MAX_DOCUMENT_BYTES + 1));
    assert.deepEqual(await oqas("knowledge", "add-document", "manuals", "quotes.md", "manual.pdf", "large.md"), {
      code: 3,
      out: "",
      err: [
        "The documents are refused, and none is kept: 2 errors were found.",
        "manual.pdf: Only Markdown documents are read: expected a file name that ends with .md or .markdown.",
        "large.md: A document holds 1000000 bytes at most.",
        "",
      ].join("\n"),
    });
    const many = Array.from({ length: 21 }, () => "quotes.md");
    assert.match((await oqas("knowledge", "add-document", "manuals", ...many)).err, /\nthe upload: Upload 20 documents at most at once\.\n$/);
    assert.deepEqual(await oqas("knowledge", "add-document", "order-specs", "quotes.md"), {
      code: 3,
      out: "",
      err: 'The configuration in force declares no knowledge source order-specs whose documents the instance keeps. Declare it in oqas.json, of type document with "stored": true, then take it with oqas config import.\n',
    });
    assert.deepEqual(await oqas("knowledge", "add-document", "manuals", "missing.md"), { code: 3, out: "", err: "missing.md cannot be read.\n" });
    assert.match((await oqas("knowledge", "list")).out, /manuals: documents the instance keeps; attached to shop\.\n  no document yet\n/);
  });

  it("fails as the other commands do on an error it does not expect", async () => {
    const { root, oqas, database } = repository();
    await oqas("config", "import");
    writeFileSync(join(root, "quotes.md"), "# Quotes\n");
    const instance = new InstanceDatabase(DatabaseUrl.parse(`sqlite:${database}`)!, { log: () => undefined, warn: () => undefined });
    await instance.database.kysely.schema.dropTable("knowledge_documents").execute();
    await instance.close();
    const broken = await oqas("knowledge", "add-document", "manuals", "quotes.md");
    assert.deepEqual([broken.code, broken.out], [5, ""]);
    assert.match(broken.err, /^oqas stopped on an unexpected error: .*knowledge_documents/);
  });
});

describe("oqas knowledge remap", () => {
  it("is refused for a source the configuration does not declare, and says which session maps the knowledge already", async () => {
    const { oqas, database } = repository();
    await oqas("config", "import");
    const unknown = await oqas("knowledge", "remap", "nowhere");
    assert.deepEqual(
      [unknown.code, unknown.err],
      [3, "The configuration in force declares no knowledge source nowhere to map; oqas knowledge mapping lists them.\n"],
    );
    const instance = new InstanceDatabase(DatabaseUrl.parse(`sqlite:${database}`)!, { log: () => undefined, warn: () => undefined });
    const waiting = await instance.sessions.ask({ purpose: "map" }, "another-host");
    await instance.close();
    const busy = await oqas("knowledge", "remap");
    assert.deepEqual([busy.code, busy.out], [0, `A session maps the knowledge already: ${waiting.id}. oqas attach ${waiting.id} follows it.\n`]);
  });

  it("opens a session that maps the source again in this command, and follows it to its end", async () => {
    const { oqas } = repository();
    await oqas("config", "import");
    const run = await oqas("knowledge", "remap", "order-specs");
    assert.match(run.err, /^Session \S+\n/);
  });
});

describe("the arguments of oqas knowledge", () => {
  it("take list, or add-document with a source and one file at least, and nothing of a session", () => {
    assert.deepEqual(parseArguments(["knowledge", "list"]), {
      ok: true,
      arguments: { output: "text", follow: false, command: { name: "knowledge", action: "list" } },
    });
    assert.deepEqual(parseArguments(["knowledge", "add-document", "manuals", "a.md", "b.md"]), {
      ok: true,
      arguments: { output: "text", follow: false, command: { name: "knowledge", action: "add-document", source: "manuals", files: ["a.md", "b.md"] } },
    });
    const usage =
      "oqas knowledge takes list, mapping or domains, check or remap and a source at most, read or remove then a source and a document, or add-document then a source and one file at least.";
    for (const argv of [["knowledge"], ["knowledge", "list", "more"], ["knowledge", "add-document", "manuals"], ["knowledge", "remove"]])
      assert.deepEqual(parseArguments(argv), { ok: false, error: usage }, argv.join(" "));
    assert.deepEqual(parseArguments(["knowledge", "list", "--follow"]), {
      ok: false,
      error: "oqas knowledge acts on the knowledge sources: it takes no --brief, --environment nor --follow.",
    });
  });
});

describe("oqas knowledge check", () => {
  it("tests each source, without the model, says what answers and why the others do not, and exits with 4", async () => {
    const { root, oqas } = repository();
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "orders.md"), "# Orders\n");
    const told = await oqas("knowledge", "check");
    assert.equal(told.code, 4);
    const lines = told.out.trimEnd().split("\n");
    assert.deepEqual(
      lines.map((line) => line.split("  ")[0]),
      ["contract", "local-contract", "shop-db", "order-specs", "manuals", "code", "server-log", "container-log"],
    );
    assert.match(told.out, /^contract {2}does not answer: fetch failed/m);
    assert.match(told.out, /^order-specs {2}answers, 1 item$/m);
    assert.match(told.out, /^manuals {2}answers, 0 items$/m);
    assert.match(told.out, /^server-log {2}not tested: logs are read while a session runs$/m);
  });

  it("tests one source when named, exits with 0 when it answers, and prints JSON when asked", async () => {
    const { root, oqas } = repository();
    mkdirSync(join(root, "specs"));
    writeFileSync(join(root, "specs", "orders.md"), "# Orders\n");
    assert.deepEqual(await oqas("knowledge", "check", "order-specs"), { code: 0, out: "order-specs  answers, 1 item\n", err: "" });
    const json = await oqas("knowledge", "check", "order-specs", "--output", "json");
    assert.deepEqual(JSON.parse(json.out), { checks: [{ source: "order-specs", check: { state: "ok", items: 1 } }] });
  });

  it("is refused for a source the configuration does not declare, and where it declares none", async () => {
    const unknown = await repository().oqas("knowledge", "check", "nowhere");
    assert.deepEqual([unknown.code, unknown.err], [3, "The configuration in force declares no knowledge source nowhere; oqas knowledge list lists them.\n"]);
    const none = await repository(fixtureConfig("http://127.0.0.1:9/v1", "http://127.0.0.1:9/", { knowledge: [] })).oqas("knowledge", "check");
    assert.deepEqual([none.code, none.err], [3, "The configuration in force declares no knowledge source.\n"]);
  });

  it("is read from its arguments: check, and a source at most", () => {
    assert.deepEqual(parseArguments(["knowledge", "check"]), {
      ok: true,
      arguments: { output: "text", follow: false, command: { name: "knowledge", action: "check" } },
    });
    assert.deepEqual(parseArguments(["knowledge", "check", "docs"]).ok, true);
    assert.deepEqual(parseArguments(["knowledge", "check", "a", "b"]), {
      ok: false,
      error:
        "oqas knowledge takes list, mapping or domains, check or remap and a source at most, read or remove then a source and a document, or add-document then a source and one file at least.",
    });
  });
});

describe("oqas knowledge mapping", () => {
  it("tells where the cartography of each source stands, and the index, as lines or as JSON", async () => {
    const { oqas } = repository();
    const told = await oqas("knowledge", "mapping");
    assert.equal(told.code, 0);
    assert.match(told.out, /^The knowledge of the environment local:\n/);
    assert.match(told.out, /\norder-specs {2}waits to be mapped\n/);
    assert.match(told.out, /\nNo index puts the cards together yet\.\n$/);
    const json = JSON.parse((await oqas("knowledge", "mapping", "--output", "json")).out) as { environment: string };
    assert.equal(json.environment, "local");
  });

  it("says each state of a source, and of the index, in plain words", () => {
    const at = "2026-11-22T09:00:00.000Z";
    assert.deepEqual(
      mappingLines({
        environment: "local",
        sources: [
          { id: "a", type: "document", state: "waiting" },
          { id: "b", type: "document", state: "mapping" },
          { id: "c", type: "document", state: "mapped", mappedAt: at },
          { id: "d", type: "web", state: "truncated", mappedAt: at },
        ],
        index: { producedAt: at, status: "truncated" },
      }),
      [
        "The knowledge of the environment local:",
        "a  waits to be mapped",
        "b  is being mapped",
        `c  mapped on ${at}`,
        `d  mapped in part: a limit stopped it on ${at}`,
        `The index was written on ${at}, in part.`,
      ],
    );
    assert.equal(mappingLines({ environment: "local", sources: [], index: { producedAt: at, status: "complete" } }).at(-1), `The index was written on ${at}.`);
    assert.deepEqual(mappingLines({ sources: [] }), ["The instance has no configuration yet: nothing is mapped."]);
  });
});
