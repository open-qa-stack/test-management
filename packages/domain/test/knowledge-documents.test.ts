import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  InvalidDocumentsError,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_NAME_LENGTH,
  MAX_DOCUMENTS_PER_UPLOAD,
  readUpload,
  storedDocumentSources,
  UnknownDocumentError,
  UnknownDocumentSourceError,
  uploadErrors,
  type ConfigError,
  type OqasConfig,
  type ReceivedFile,
} from "../src/index.ts";
import { errorsOf, example, listAt, validateVariant } from "./helpers.ts";

/** A source of documents the instance keeps, attached to an application of the example. */
const STORED = { id: "specs", type: "document", stored: true, attachments: [{ application: "policy-management" }] };

/** A file of an upload, its content the UTF-8 of a text. */
const file = (name: string, text = "# Quotes\n"): ReceivedFile => {
  const content = new TextEncoder().encode(text);
  return { name, bytes: content.length, content };
};

/** The pointers and the rules of errors. */
const placed = (errors: readonly ConfigError[]) => errors.map(({ path, rule }) => [path, rule]);

describe("a source of documents the instance keeps", () => {
  it("is declared stored, without a path", () => {
    const result = validateVariant((c) => listAt(c, "knowledge").push(STORED));
    assert.equal(result.ok, true, JSON.stringify(result));
  });

  it("is given, once resolved, the folder of the state folder a run writes its documents to", () => {
    const result = validateVariant((c) => {
      listAt(c, "knowledge").push(STORED);
      c["repository"] = { stateDir: "state" };
    });
    assert.ok(result.ok);
    assert.deepEqual(result.config.knowledge.at(-1), {
      id: "specs",
      type: "document",
      attachments: [{ application: "policy-management" }],
      path: "state/documents/specs",
    });
  });

  it("keeps the documents of the test repository as they are declared", () => {
    const declared = { id: "notes", type: "document", path: "specs", attachments: [{ application: "policy-management" }] };
    const result = validateVariant((c) => listAt(c, "knowledge").push(declared));
    assert.ok(result.ok);
    assert.deepEqual(result.config.knowledge.at(-1), declared);
  });

  it("declares exactly one of a path and stored", () => {
    const both = errorsOf(validateVariant((c) => listAt(c, "knowledge").push({ ...STORED, path: "specs" })));
    const neither = errorsOf(validateVariant((c) => listAt(c, "knowledge").push({ ...STORED, stored: undefined })));
    for (const errors of [both, neither]) assert.deepEqual(placed(errors), [["/knowledge/8", "document-source"]]);
  });

  it("is stored only as true", () => {
    const errors = errorsOf(validateVariant((c) => listAt(c, "knowledge").push({ ...STORED, stored: false })));
    assert.deepEqual(placed(errors), [["/knowledge/8/stored", "unknown-variant"]]);
  });

  it("is listed by its identifier, in the order of the configuration", () => {
    const config = example();
    listAt(config, "knowledge").push(
      { ...STORED, id: "b" },
      { id: "notes", type: "document", path: "specs", attachments: STORED.attachments },
      { ...STORED, id: "a" },
    );
    assert.deepEqual(storedDocumentSources(config as unknown as OqasConfig), ["b", "a"]);
  });
});

describe("an upload of documents", () => {
  it("is read as its documents, each a text in UTF-8, the mark of its order left out", () => {
    const marked = { name: "b.markdown", bytes: 6, content: new Uint8Array([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x42]) };
    assert.deepEqual(readUpload([file("Quotes.MD"), marked]), {
      ok: true,
      entries: [
        { name: "Quotes.MD", text: "# Quotes\n" },
        { name: "b.markdown", text: "# B" },
      ],
    });
  });

  it("holds one document at least, and so many at most", () => {
    assert.deepEqual(placed(uploadErrors([])), [["", "no-documents"]]);
    const many = Array.from({ length: MAX_DOCUMENTS_PER_UPLOAD + 1 }, (_, rank) => ({ name: `${rank}.md`, bytes: 1 }));
    assert.deepEqual(placed(uploadErrors(many)), [["", "too-many-documents"]]);
    assert.deepEqual(uploadErrors(many.slice(1)), []);
  });

  it("refuses a name that is empty, too long, hidden, or holds a slash or a control character", () => {
    const names = [
      "",
      `${"a".repeat(MAX_DOCUMENT_NAME_LENGTH - 2)}.md`,
      ".notes.md",
      "specs/quotes.md",
      "specs\\quotes.md",
      "quo\u0007tes.md",
      "quo\u007ftes.md",
    ];
    const errors = uploadErrors(names.map((name) => ({ name, bytes: 1 })));
    assert.deepEqual(placed(errors), [
      ["/documents/0", "document-name"],
      ["/documents/1", "document-name"],
      ["/documents/2", "document-name"],
      ["/documents/3", "document-name"],
      ["/documents/4", "document-name"],
      ["/documents/5", "document-name"],
      ["/documents/6", "document-name"],
    ]);
    assert.deepEqual(uploadErrors([{ name: `${"a".repeat(MAX_DOCUMENT_NAME_LENGTH - 3)}.md`, bytes: 1 }]), []);
  });

  it("refuses a format the agents do not read, a name given twice and a document too large", () => {
    const errors = uploadErrors([
      { name: "quotes.pdf", bytes: 1 },
      { name: "README", bytes: 1 },
      { name: "a.md", bytes: MAX_DOCUMENT_BYTES },
      { name: "a.md", bytes: 1 },
      { name: "b.md", bytes: MAX_DOCUMENT_BYTES + 1 },
    ]);
    assert.deepEqual(placed(errors), [
      ["/documents/0", "document-format"],
      ["/documents/1", "document-format"],
      ["/documents/3", "duplicate"],
      ["/documents/4", "document-size"],
    ]);
  });

  it("refuses a file that is not text in UTF-8, and keeps none of the others", () => {
    const binary = { name: "image.md", bytes: 2, content: new Uint8Array([0xff, 0xfe]) };
    const read = readUpload([file("a.md"), binary]);
    assert.deepEqual(read.ok ? [] : placed(read.errors), [["/documents/1", "document-encoding"]]);
    const refused = readUpload([{ ...file("a.md"), bytes: MAX_DOCUMENT_BYTES + 1 }]);
    assert.deepEqual(refused.ok ? [] : placed(refused.errors), [["/documents/0", "document-size"]]);
  });
});

describe("the refusals of the documents", () => {
  it("name the source and the document asked for, or count the errors of an upload", () => {
    assert.equal(
      new UnknownDocumentSourceError("specs").message,
      "The configuration in force declares no knowledge source specs whose documents the instance keeps.",
    );
    assert.equal(new UnknownDocumentError("specs", "a.md").message, "The knowledge source specs holds no document a.md.");
    const error: ConfigError = { kind: "structure", path: "/documents/0", rule: "duplicate", message: "Duplicate document name." };
    assert.equal(new InvalidDocumentsError([error]).message, "The documents are refused, and none is kept: 1 error was found.");
    const refused = new InvalidDocumentsError([error, error]);
    assert.deepEqual(
      [refused.name, refused.message, refused.errors],
      ["InvalidDocumentsError", "The documents are refused, and none is kept: 2 errors were found.", [error, error]],
    );
    assert.deepEqual(
      [new UnknownDocumentSourceError("s").name, new UnknownDocumentError("s", "d").name],
      ["UnknownDocumentSourceError", "UnknownDocumentError"],
    );
  });
});
