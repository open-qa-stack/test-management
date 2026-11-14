import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { placementSubmissionSchema, sourceManifestSchema, validatePlacementSubmission, validateSourceManifest, type SourceManifest } from "../src/index.ts";
import { MANIFEST_SCHEMA_FILE, renderSchema } from "../scripts/emit-schema.ts";

const EXAMPLE = JSON.parse(readFileSync(new URL("../examples/source-manifest/orders-db.json", import.meta.url), "utf8")) as SourceManifest;
const errorsOf = (result: { ok: boolean; errors?: unknown }) => (result.ok ? [] : result.errors);

describe("the source manifest format", () => {
  it("is a valid draft 2020-12 schema, published unchanged", () => {
    assert.equal(new Ajv2020({ strict: false }).validateSchema(sourceManifestSchema), true);
    assert.equal(readFileSync(MANIFEST_SCHEMA_FILE, "utf8"), renderSchema(sourceManifestSchema));
  });

  it("accepts the documented example, a source without element, and an element left unplaced", () => {
    assert.deepEqual(validateSourceManifest(EXAMPLE), { ok: true, value: EXAMPLE });
    assert.equal(validateSourceManifest({ ...EXAMPLE, status: "in_progress", domains: [], elements: [] }).ok, true);
    const { dismissed: _dismissed, ...aside } = EXAMPLE.elements[2]!;
    assert.equal(validateSourceManifest({ ...EXAMPLE, status: "truncated", elements: [{ ...aside, unplaced: "The model had 3 calls." }] }).ok, true);
  });

  it("names the field in fault", () => {
    const nameless = structuredClone(EXAMPLE);
    nameless.elements[0]!.file = "";
    assert.deepEqual(errorsOf(validateSourceManifest(nameless)), [
      { path: "/elements/0/file", message: "/elements/0/file must NOT have fewer than 1 characters." },
    ]);
    const { fingerprint: _fingerprint, ...unsigned } = EXAMPLE.elements[2]!;
    assert.deepEqual(errorsOf(validateSourceManifest({ ...EXAMPLE, elements: [unsigned] })), [
      { path: "/elements/0/fingerprint", message: "/elements/0 must have required property 'fingerprint'." },
    ]);
    assert.deepEqual(errorsOf(validateSourceManifest({ ...EXAMPLE, model: "local-model" })), [{ path: "/model", message: "/model is not allowed." }]);
    assert.deepEqual(errorsOf(validateSourceManifest({ ...EXAMPLE, status: "kept" })), [
      { path: "/status", message: "/status must be equal to one of the allowed values." },
    ]);
    const named = structuredClone(EXAMPLE);
    named.domains[0]!.id = "Customers";
    assert.deepEqual(errorsOf(validateSourceManifest(named)), [
      { path: "/domains/0/id", message: '/domains/0/id must match pattern "^[a-z0-9]+(-[a-z0-9]+)*$".' },
    ]);
  });

  it("refuses an element or a domain named twice, and an element in a domain the manifest does not have", () => {
    const twice = structuredClone(EXAMPLE);
    twice.elements.push({ ...twice.elements[0]!, kind: "view" });
    twice.domains.push(twice.domains[0]!);
    twice.elements[1]!.domain = "billing";
    assert.deepEqual(errorsOf(validateSourceManifest(twice)), [
      { path: "/domains/2/id", message: "/domains/2/id repeats the domain customers." },
      { path: "/elements/5/name", message: "/elements/5/name repeats the element public.customers." },
      { path: "/elements/1/domain", message: "/elements/1/domain names the domain billing, which the manifest does not have." },
    ]);
  });
});

describe("what the model hands in for a batch of elements", () => {
  it("is a valid draft 2020-12 schema, which takes new domains or none, and each element in a domain or set aside", () => {
    assert.equal(new Ajv2020({ strict: false }).validateSchema(placementSubmissionSchema), true);
    const submission = {
      domains: [{ id: "Any Text", label: "Orders", description: "Orders." }],
      items: [
        { name: "public.orders", domain: "Any Text", role: "An order." },
        { name: "public.schema_migrations", reason: "Technical." },
      ],
    };
    assert.deepEqual(validatePlacementSubmission(submission), { ok: true, value: submission });
    assert.equal(validatePlacementSubmission({ items: submission.items }).ok, true);
  });

  it("names the field in fault", () => {
    assert.deepEqual(errorsOf(validatePlacementSubmission({ items: [] })), [{ path: "/items", message: "/items must NOT have fewer than 1 items." }]);
    assert.deepEqual(errorsOf(validatePlacementSubmission({ domains: [{ id: "orders" }], items: [{ domain: "orders", summary: "An order." }] })), [
      { path: "/domains/0/label", message: "/domains/0 must have required property 'label'." },
      { path: "/domains/0/description", message: "/domains/0 must have required property 'description'." },
      { path: "/items/0/name", message: "/items/0 must have required property 'name'." },
      { path: "/items/0/summary", message: "/items/0/summary is not allowed." },
    ]);
  });
});
