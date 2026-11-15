import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { fileURLToPath } from "node:url";
import { contractExport, operationName } from "../src/openapi/contract-export.ts";
import { OpenApiContract } from "../src/openapi/openapi-contract.ts";

const REPOSITORY = fileURLToPath(new URL("./fixtures/repository/", import.meta.url));
const contract = (path: string) => new OpenApiContract({ id: "api", type: "openapi", path, attachments: [] }, REPOSITORY);

describe("what a contract defines", () => {
  it("is its operations, each with the parameters of its path, and its named schemas, a parameter given by a local reference being the one it points to", async () => {
    const { operations, schemas } = await contract("contracts/claims.json").definitions();
    assert.deepEqual(
      operations.map(({ method, path }) => operationName(method, path)),
      ["POST /claims"],
    );
    // Every other reference is kept: a schema is read in its own element.
    assert.deepEqual(operations[0]!.operation["parameters"], [
      { name: "tenant", in: "header", required: true },
      undefined,
      { name: "claim", in: "body", schema: { $ref: "#/definitions/Claim" } },
    ]);
    // A name both holders give is given once, as the first writes it.
    assert.deepEqual(schemas, [
      { name: "Claim", schema: { type: "object" } },
      { name: "Money", schema: { type: "number" } },
      { name: "Status", schema: { enum: ["open", "closed"] } },
    ]);
    const policies = await contract("contracts/policies.json").definitions();
    assert.equal(policies.operations[0]!.operation["parameters"], undefined);
    assert.deepEqual(await contract("contracts/empty.json").definitions(), { operations: [], schemas: [] });
  });
});

describe("the export of a contract", () => {
  it("holds an element per operation, then per schema, each with a summary that tells it from the others, its names and the schemas it refers to", () => {
    const order = { $ref: "#/components/schemas/Order" };
    const exported = contractExport({
      operations: [
        {
          method: "POST",
          path: "/orders/{orderId}/lines",
          operation: {
            operationId: "addLine",
            summary: "Add a line to an order",
            tags: ["orders", 3],
            parameters: [{ name: "orderId", in: "path", required: true }, { name: "dryRun", in: "query" }, { in: "query" }, "odd"],
            requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Line" } } } },
            responses: {
              "201": { content: { "application/json": { schema: order } } },
              "404": {},
              default: { schema: { $ref: "#/components/schemas/Unknown" } },
            },
          },
        },
        { method: "GET", path: "/health", operation: { parameters: [{ name: "body", in: "body", schema: { $ref: "#/definitions/Line" } }] } },
      ],
      schemas: [
        {
          name: "Order",
          schema: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string" },
              lines: { type: "array", items: { $ref: "#/components/schemas/Line" } },
              parent: order,
              meta: {},
              tags: { type: "array" },
            },
          },
        },
        { name: "Line", schema: { properties: { "a/b": { $ref: "#/components/schemas/a~1b" } } } },
        { name: "Status", schema: { enum: ["open", "closed"] } },
        { name: "a/b", schema: "odd" },
      ],
    });
    assert.deepEqual(
      exported.elements.map((element) => [element.name, element.kind, element.file]),
      [
        ["POST /orders/{orderId}/lines", "operation", "operations/POST_orders_orderId_lines-" + exported.elements[0]!.file.slice(-13)],
        ["GET /health", "operation", "operations/GET_health-" + exported.elements[1]!.file.slice(-13)],
        ["Order", "schema", "schemas/Order-" + exported.elements[2]!.file.slice(-13)],
        ["Line", "schema", "schemas/Line-" + exported.elements[3]!.file.slice(-13)],
        ["Status", "schema", "schemas/Status-" + exported.elements[4]!.file.slice(-13)],
        ["a/b", "schema", "schemas/a_b-" + exported.elements[5]!.file.slice(-13)],
      ],
    );
    const [add, health, orderSchema, line, status, odd] = exported.elements;
    assert.equal(
      add!.summary,
      [
        "operation POST /orders/{orderId}/lines — Add a line to an order",
        "id: addLine",
        "tags: orders",
        "parameters: orderId (path, required), dryRun (query)",
        "body: Line",
        "responses: 201 Order; 404; default Unknown",
      ].join("\n  "),
    );
    // Its links are the schemas of the contract it refers to: one the contract does not define is none.
    assert.deepEqual(
      [add!.names, add!.links],
      [
        ["addLine", "orderId", "dryRun"],
        ["Line", "Order"],
      ],
    );
    assert.equal(JSON.parse(add!.definition).operationId, "addLine");
    assert.equal(health!.summary, "operation GET /health\n  parameters: body (body)\n  body: Line");
    assert.equal(
      orderSchema!.summary,
      "schema Order\n  properties: id (string), lines (array of Line), parent (Order), meta (object), tags (array of object)\n  required: id",
    );
    // A schema that refers to itself links to the others only.
    assert.deepEqual([orderSchema!.names, orderSchema!.links], [["id", "lines", "parent", "meta", "tags"], ["Line"]]);
    assert.deepEqual([line!.summary, line!.links], ["schema Line\n  properties: a/b (a/b)", ["a/b"]]);
    assert.equal(status!.summary, "schema Status\n  enum: open, closed");
    assert.deepEqual([odd!.summary, odd!.names, odd!.definition], ["schema a/b", [], '"odd"']);
    assert.match(exported.fingerprint, /^sha256:[0-9a-f]{64}$/);
    assert.match(add!.fingerprint, /^sha256:[0-9a-f]{64}$/);
  });
});
