import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { sourceManifestSchema, validateSourceManifest, type SourceManifest } from "../src/index.ts";
import { MANIFEST_SCHEMA_FILE, renderSchema } from "../scripts/emit-schema.ts";

const EXAMPLE = JSON.parse(readFileSync(new URL("../examples/source-manifest/orders-db.json", import.meta.url), "utf8")) as SourceManifest;
const errorsOf = (result: { ok: boolean; errors?: unknown }) => (result.ok ? [] : result.errors);

describe("the source manifest format", () => {
  it("is a valid draft 2020-12 schema, published unchanged", () => {
    assert.equal(new Ajv2020({ strict: false }).validateSchema(sourceManifestSchema), true);
    assert.equal(readFileSync(MANIFEST_SCHEMA_FILE, "utf8"), renderSchema(sourceManifestSchema));
  });

  it("accepts the documented example, and a source without element", () => {
    assert.deepEqual(validateSourceManifest(EXAMPLE), { ok: true, value: EXAMPLE });
    assert.equal(validateSourceManifest({ ...EXAMPLE, status: "truncated", elements: [] }).ok, true);
  });

  it("names the field in fault", () => {
    const nameless = structuredClone(EXAMPLE);
    nameless.elements[0]!.file = "";
    assert.deepEqual(errorsOf(validateSourceManifest(nameless)), [
      { path: "/elements/0/file", message: "/elements/0/file must NOT have fewer than 1 characters." },
    ]);
    const { fingerprint: _fingerprint, ...unsigned } = EXAMPLE.elements[1]!;
    assert.deepEqual(errorsOf(validateSourceManifest({ ...EXAMPLE, elements: [unsigned] })), [
      { path: "/elements/0/fingerprint", message: "/elements/0 must have required property 'fingerprint'." },
    ]);
    assert.deepEqual(errorsOf(validateSourceManifest({ ...EXAMPLE, model: "local-model" })), [{ path: "/model", message: "/model is not allowed." }]);
    assert.deepEqual(errorsOf(validateSourceManifest({ ...EXAMPLE, status: "kept" })), [
      { path: "/status", message: "/status must be equal to one of the allowed values." },
    ]);
  });

  it("refuses an element named twice", () => {
    const twice = structuredClone(EXAMPLE);
    twice.elements.push({ ...twice.elements[0]!, kind: "view" });
    assert.deepEqual(errorsOf(validateSourceManifest(twice)), [
      { path: "/elements/4/name", message: "/elements/4/name repeats the element public.customers." },
    ]);
  });
});
