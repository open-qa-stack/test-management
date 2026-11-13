import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { domainIndexSchema, placementErrors, validateDomainIndex, validateDomainSubmission, type DomainIndex, type DomainIndexSubmission } from "../src/index.ts";
import { INDEX_SCHEMA_FILE, renderSchema } from "../scripts/emit-schema.ts";

const EXAMPLE = JSON.parse(readFileSync(new URL("../examples/domain-index/domain-index.json", import.meta.url), "utf8")) as DomainIndex;
const copy = (): DomainIndex => structuredClone(EXAMPLE);
const errorsOf = (result: { ok: boolean; errors?: unknown }) => (result.ok ? [] : result.errors);

describe("the domain index format", () => {
  it("is a valid draft 2020-12 schema, published unchanged", () => {
    assert.equal(new Ajv2020({ strict: false }).validateSchema(domainIndexSchema), true);
    assert.equal(readFileSync(INDEX_SCHEMA_FILE, "utf8"), renderSchema(domainIndexSchema));
  });

  it("accepts the documented example", () => {
    assert.deepEqual(validateDomainIndex(EXAMPLE), { ok: true, value: EXAMPLE });
  });

  it("names the field in fault", () => {
    const missing = copy() as Partial<DomainIndex>;
    delete missing.run;
    const wrong = { ...copy(), status: "done" };
    const extra = { ...copy(), secret: "x" };
    const empty = { ...copy(), domains: [{ ...copy().domains[0]!, label: "" }] };
    assert.deepEqual(errorsOf(validateDomainIndex(missing)), [{ path: "/run", message: "The document must have required property 'run'." }]);
    assert.deepEqual(errorsOf(validateDomainIndex(wrong)), [{ path: "/status", message: "/status must be equal to one of the allowed values." }]);
    assert.deepEqual(errorsOf(validateDomainIndex(extra)), [{ path: "/secret", message: "/secret is not allowed." }]);
    assert.deepEqual(errorsOf(validateDomainIndex(empty)), [{ path: "/domains/0/label", message: "/domains/0/label must NOT have fewer than 1 characters." }]);
  });

  it("refuses a repeated domain, a reference to an unlisted source, and a complete index with a source not read", () => {
    const index = copy();
    index.domains.push({ ...index.domains[0]! });
    index.unassigned.push({ source: "elsewhere", items: ["x"] });
    index.sources[3]!.state = "not_read";
    index.sources.push({ ...index.sources[0]! });
    const result = validateDomainIndex(index);
    assert.deepEqual((errorsOf(result) as { path: string }[]).map((e) => e.path), ["/domains/2/id", "/sources/4/id", "/unassigned/1/source", "/status"]);
    index.domains.pop();
    index.unassigned.pop();
    index.sources.pop();
    assert.equal(validateDomainIndex({ ...index, status: "truncated" }).ok, true);
  });
});

describe("a submission of the cartographer", () => {
  const submission = (): DomainIndexSubmission => ({ domains: copy().domains, unassigned: copy().unassigned });
  const inventory = new Map([
    ["orders-api", ["orders", "payments", "customers"]],
    ["orders-db", ["public.orders", "public.order_lines", "public.customers", "public.schema_migrations"]],
  ]);
  const sources = new Set(["orders-api", "orders-db", "storefront", "order-specs"]);

  it("is valid against its schema, with unique domains", () => {
    assert.equal(validateDomainSubmission(submission()).ok, true);
    assert.deepEqual(validateDomainSubmission({ domains: [] }), {
      ok: false,
      errors: [
        { path: "/unassigned", message: "The document must have required property 'unassigned'." },
        { path: "/domains", message: "/domains must NOT have fewer than 1 items." },
      ],
    });
    const twice = submission();
    twice.domains.push(twice.domains[1]!);
    assert.deepEqual(validateDomainSubmission(twice), { ok: false, errors: [{ path: "/domains/2/id", message: "/domains/2/id repeats the domain customers." }] });
  });

  it("places every tag and every table, and nothing else", () => {
    assert.deepEqual(placementErrors(submission(), inventory, sources), []);
    const forgetful = submission();
    forgetful.unassigned = [];
    forgetful.domains[0]!.references[1]!.items.push("public.invented");
    forgetful.domains[1]!.references.push({ source: "nowhere", items: ["x"] });
    assert.deepEqual(placementErrors(forgetful, inventory, sources), [
      { path: "/domains/0/references/1/items/2", message: "/domains/0/references/1/items/2: public.invented is not an item of orders-db; use one of the items listed for it." },
      { path: "/domains/1/references/3/source", message: "/domains/1/references/3/source names nowhere, which is not a source of this run." },
      { path: "", message: "public.schema_migrations of orders-db is in no domain nor in unassigned." },
    ]);
  });
});
