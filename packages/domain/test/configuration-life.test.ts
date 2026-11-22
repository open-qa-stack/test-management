import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  configurationText,
  fileStateOf,
  InvalidConfigurationError,
  NoConfigurationError,
  revisionDocument,
  StaleRevisionError,
  type OqasConfig,
  type RevisionSummary,
} from "../src/index.ts";
import { example, exampleText } from "./helpers.ts";

/** A revision, as the store tells it, read from a file of the given digest. */
const REVISION: RevisionSummary = { number: 3, recordedAt: "2026-11-18T09:00:00.000Z", origin: "file", fileDigest: "a1" };

/** The keys of an object, from its JSON text. */
const keysOf = (text: string, path: (value: Record<string, unknown>) => unknown): string[] =>
  Object.keys(path(JSON.parse(text) as Record<string, unknown>) as Record<string, unknown>);

/** The same value, the keys of each of its objects in the reverse order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, child]) => [key, reversed(child)]),
  );
}

describe("the text of a configuration a change writes", () => {
  it("is the same for the same document, whatever the order of its keys, and orders them as the schema declares them", () => {
    const document = example() as unknown as OqasConfig;
    const text = configurationText(document);
    assert.equal(configurationText(reversed(document) as OqasConfig), text);
    assert.deepEqual(JSON.parse(text), document);
    assert.ok(text.endsWith("}\n"));
    assert.match(text, /^\{\n {2}"\$schema": /);
    assert.deepEqual(
      keysOf(text, (root) => root),
      Object.keys(document).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)),
    );
    assert.deepEqual(
      keysOf(text, (root) => root["model"]),
      ["mode", "provider", "baseUrl", "model", "apiKeyEnv"].filter((key) => key in document.model),
    );
  });

  it("orders the keys of each kind of knowledge, and of each level of autonomy, as its own branch declares them", () => {
    const document = {
      ...(example() as unknown as OqasConfig),
      autonomy: { guardrailMinutes: 30, task: { maxActions: 9, maxMinutes: 5 }, level: "bounded" },
      knowledge: [{ path: "specs/a.md", attachments: [{ application: "customer-core" }], type: "document", id: "specs" }],
    } as OqasConfig;
    const text = configurationText(document);
    assert.deepEqual(
      keysOf(text, (root) => root["autonomy"]),
      ["level", "task", "guardrailMinutes"],
    );
    assert.deepEqual(
      keysOf(text, (root) => (root["autonomy"] as Record<string, unknown>)["task"]),
      ["maxMinutes", "maxActions"],
    );
    assert.deepEqual(
      keysOf(text, (root) => (root["knowledge"] as unknown[])[0]),
      ["id", "attachments", "type", "path"],
    );
  });
});

/** The keys of the root of a configuration, as the schema declares them. */
const ORDER = ["$schema", "formatVersion", "applications", "knowledge", "repository", "charter", "cartography", "design", "model", "autonomy"];

describe("the document of a revision", () => {
  it("is the configuration as it was written, a byte order mark left out, whatever variable of the environment is set", () => {
    const read = revisionDocument(`﻿${exampleText()}`);
    assert.deepEqual(read, { ok: true, document: example() });
  });

  it("is refused with every error the schema finds, each where it is", () => {
    const read = revisionDocument(JSON.stringify({ ...example(), applications: [], extra: true }));
    assert.deepEqual(read.ok ? [] : read.errors.map(({ path, rule }) => `${path} ${rule}`), ["/extra unknown-key", "/applications too-few-items"]);
    assert.deepEqual(revisionDocument("{"), { ok: false, errors: [{ kind: "syntax", path: "", rule: "json", message: "The file is not valid JSON." }] });
  });
});

describe("how the configuration file stands to the revision in force", () => {
  it("is in step when it is the file the revision read or wrote, changed otherwise or with no revision, and missing when it cannot be read", () => {
    assert.deepEqual(
      [fileStateOf(REVISION, "a1"), fileStateOf(REVISION, "b2"), fileStateOf(undefined, "a1"), fileStateOf(REVISION, undefined)],
      ["in_step", "changed", "changed", "missing"],
    );
  });
});

describe("the refusals of the configuration", () => {
  it("say what was refused, and keep what a presentation tells of it", () => {
    const stale = new StaleRevisionError(2, 4);
    assert.deepEqual([stale.name, stale.basedOn, stale.inForce], ["StaleRevisionError", 2, 4]);
    assert.equal(stale.message, "The change was made from the revision 2 of the configuration, and the revision in force is 4.");
    const error = { kind: "structure", path: "/model", rule: "required", message: 'Missing required key "model".' } as const;
    const one = new InvalidConfigurationError("The file", [error]);
    assert.deepEqual(
      [one.name, one.message, one.errors, one.inForce],
      ["InvalidConfigurationError", "The file is not a valid configuration: 1 error was found.", [error], undefined],
    );
    assert.equal(new InvalidConfigurationError("The file", [error], 4).inForce, 4);
    assert.equal(new InvalidConfigurationError("The change", [error, error]).message, "The change is not a valid configuration: 2 errors were found.");
    const none = new NoConfigurationError("/tests/settings.json");
    assert.deepEqual(
      [none.name, none.message],
      ["NoConfigurationError", "/tests/settings.json cannot be read, and the instance keeps no revision of the configuration."],
    );
  });
});
