import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { sourceCardSchema, validateSourceCard, validateSourceCardSubmission, type SourceCard } from "../src/index.ts";
import { CARD_SCHEMA_FILE, renderSchema } from "../scripts/emit-schema.ts";

const EXAMPLE = JSON.parse(readFileSync(new URL("../examples/source-card/orders-db.json", import.meta.url), "utf8")) as SourceCard;
const errorsOf = (result: { ok: boolean; errors?: unknown }) => (result.ok ? [] : result.errors);

describe("the source card format", () => {
  it("is a valid draft 2020-12 schema, published unchanged", () => {
    assert.equal(new Ajv2020({ strict: false }).validateSchema(sourceCardSchema), true);
    assert.equal(readFileSync(CARD_SCHEMA_FILE, "utf8"), renderSchema(sourceCardSchema));
  });

  it("accepts the documented example, and names the field in fault", () => {
    assert.deepEqual(validateSourceCard(EXAMPLE), { ok: true, value: EXAMPLE });
    const wrong = structuredClone(EXAMPLE);
    wrong.domains[0]!.items[0]!.summary = "";
    assert.deepEqual(errorsOf(validateSourceCard(wrong)), [
      { path: "/domains/0/items/0/summary", message: "/domains/0/items/0/summary must NOT have fewer than 1 characters." },
    ]);
    const twice = structuredClone(EXAMPLE);
    twice.domains.push(twice.domains[0]!);
    assert.deepEqual(errorsOf(validateSourceCard(twice)), [{ path: "/domains/2/id", message: "/domains/2/id repeats the domain orders." }]);
  });
});

describe("a submission of the cartographer of one source", () => {
  it("gives names, summaries and key fields, but no facts, which the harness reads itself", () => {
    const submission = {
      domains: [{ id: "orders", label: "Orders", description: "Orders.", items: [{ name: "public.orders", summary: "An order.", keyFields: ["status"] }] }],
      unassigned: [],
    };
    assert.equal(validateSourceCardSubmission(submission).ok, true);
    const withFacts = structuredClone(submission) as { domains: { items: Record<string, unknown>[] }[] };
    withFacts.domains[0]!.items[0]!["facts"] = { columns: 1 };
    assert.deepEqual(errorsOf(validateSourceCardSubmission(withFacts)), [
      { path: "/domains/0/items/0/facts", message: "/domains/0/items/0/facts is not allowed." },
    ]);
    const twice = { ...submission, domains: [...submission.domains, submission.domains[0]!] };
    assert.deepEqual(errorsOf(validateSourceCardSubmission(twice)), [{ path: "/domains/1/id", message: "/domains/1/id repeats the domain orders." }]);
  });
});
