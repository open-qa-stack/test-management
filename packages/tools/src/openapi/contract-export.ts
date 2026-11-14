import { exportFile, sourceExport, type ElementDraft, type SourceExport } from "../common/source-export.ts";
import type { ContractDefinitions } from "./openapi-contract.ts";

/** A local `$ref` to a named schema, of OpenAPI 3 or of Swagger 2. */
const SCHEMA_REF = /^#\/(?:components\/schemas|definitions)\/(.+)$/;

/**
 * The name of an operation in the export of a contract.
 *
 * @param method - Its HTTP method, upper case.
 * @param path - Its path, as the contract writes it.
 * @returns `METHOD /path`.
 */
export function operationName(method: string, path: string): string {
  return `${method} ${path}`;
}

/**
 * Exports what a contract defines, element by element.
 *
 * @remarks
 * The elements are its operations, each as `METHOD /path`, then its named schemas, each under its name, all
 * in the order of the document. The definition of an element is what the contract writes of it, as JSON,
 * its `$ref` kept: a schema is read in its own element. The summary of an operation gives its title, its
 * identifier, its tags, its parameters with where each goes, the schemas of its body and, for each
 * response, its status and its schemas; its names are its identifier and its parameters, and its links the
 * schemas it refers to. The summary of a schema gives its properties with their types, those required and
 * the values of an enumeration; its names are its properties, and its links the other schemas it refers to.
 *
 * @param definitions - What the contract defines.
 * @returns The export of the contract.
 */
export function contractExport(definitions: ContractDefinitions): SourceExport {
  const schemas = new Set(definitions.schemas.map((schema) => schema.name));
  const linked = (value: unknown, self?: string) => refsOf(value).filter((name) => schemas.has(name) && name !== self);
  return sourceExport([
    ...definitions.operations.map(({ method, path, operation }) => operationElement(operationName(method, path), operation, linked)),
    ...definitions.schemas.map(({ name, schema }) => schemaElement(name, schema, linked(schema, name))),
  ]);
}

/** An operation, as an element of the export. */
function operationElement(name: string, operation: Readonly<Record<string, unknown>>, linked: (value: unknown) => string[]): ElementDraft {
  const text = (key: string) => (typeof operation[key] === "string" ? [operation[key]] : []);
  const parameters = list(operation["parameters"]).flatMap((parameter) => {
    const { name: named, in: where, required } = record(parameter);
    return typeof named === "string"
      ? [{ name: named, told: `${named} (${[where, required === true ? "required" : undefined].filter(Boolean).join(", ")})` }]
      : [];
  });
  const body = refsOf([operation["requestBody"], list(operation["parameters"]).filter((parameter) => record(parameter)["in"] === "body")]);
  const responses = Object.entries(record(operation["responses"])).map(([status, response]) => [status, ...refsOf(response)].join(" "));
  const tags = list(operation["tags"]).filter((tag) => typeof tag === "string" && tag.trim() !== "");
  const summary = [
    `operation ${name}${text("summary")
      .map((title) => ` — ${title}`)
      .join("")}`,
    ...text("operationId").map((id) => `id: ${id}`),
    ...(tags.length === 0 ? [] : [`tags: ${tags.join(", ")}`]),
    ...(parameters.length === 0 ? [] : [`parameters: ${parameters.map((parameter) => parameter.told).join(", ")}`]),
    ...(body.length === 0 ? [] : [`body: ${body.join(", ")}`]),
    ...(responses.length === 0 ? [] : [`responses: ${responses.join("; ")}`]),
  ];
  return {
    name,
    kind: "operation",
    summary: summary.join("\n  "),
    definition: JSON.stringify(operation, null, 2),
    names: [...text("operationId"), ...parameters.map((parameter) => parameter.name)],
    links: linked(operation),
    file: exportFile("operations", name, "json"),
  };
}

/** A named schema, as an element of the export. */
function schemaElement(name: string, schema: unknown, links: string[]): ElementDraft {
  const { properties, required, enum: values } = record(schema);
  const fields = Object.entries(record(properties));
  const summary = [
    `schema ${name}`,
    ...(fields.length === 0 ? [] : [`properties: ${fields.map(([field, type]) => `${field} (${typeOf(type)})`).join(", ")}`]),
    ...(list(required).length === 0 ? [] : [`required: ${list(required).join(", ")}`]),
    ...(list(values).length === 0 ? [] : [`enum: ${list(values).join(", ")}`]),
  ];
  return {
    name,
    kind: "schema",
    summary: summary.join("\n  "),
    definition: JSON.stringify(schema, null, 2),
    names: fields.map(([field]) => field),
    links,
    file: exportFile("schemas", name, "json"),
  };
}

/** The type of a property, in a word: the schema it refers to, what its array holds, or its type. */
function typeOf(schema: unknown): string {
  const { $ref, type, items } = record(schema);
  const [named] = refsOf({ $ref });
  if (named !== undefined) return named;
  if (type === "array") return `array of ${typeOf(items)}`;
  return typeof type === "string" ? type : "object";
}

/** The names of the schemas a value refers to, anywhere in it, each once, in the order met. */
function refsOf(value: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    for (const [key, held] of Object.entries(node)) {
      const name = key === "$ref" && typeof held === "string" ? SCHEMA_REF.exec(held)?.[1] : undefined;
      if (name === undefined) walk(held);
      else found.add(name.replaceAll("~1", "/").replaceAll("~0", "~"));
    }
  };
  walk(value);
  return [...found];
}

/** A value as a list: itself when it is an array, none otherwise. */
function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A value as a record: itself when it is an object, an empty one otherwise. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
