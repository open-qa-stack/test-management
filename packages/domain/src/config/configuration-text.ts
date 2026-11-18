import { isRecord } from "../json.ts";
import { configSchema } from "./schema.ts";
import type { OqasConfig } from "./types.ts";

/** A node of the schema of the configuration file, as far as the order of its keys is read from it. */
interface SchemaNode {
  readonly $ref?: string;
  readonly properties?: Readonly<Record<string, SchemaNode>>;
  readonly items?: SchemaNode;
  readonly discriminator?: { readonly propertyName: string };
  readonly oneOf?: readonly SchemaNode[];
  readonly const?: unknown;
}

const DEFINITIONS = configSchema.$defs as Readonly<Record<string, SchemaNode>>;

/** The node a reference of the schema names, or the node itself. */
function resolved(node: SchemaNode): SchemaNode {
  return node.$ref === undefined ? node : DEFINITIONS[node.$ref.slice("#/$defs/".length)]!;
}

/** The node that describes an object: the branch its tag names, for a node whose branches a tag tells apart. */
function shapeOf(node: SchemaNode, value: Readonly<Record<string, unknown>>): SchemaNode {
  const { discriminator, oneOf } = resolved(node);
  if (discriminator === undefined) return resolved(node);
  const tag = value[discriminator.propertyName];
  return oneOf!.find((branch) => branch.properties![discriminator.propertyName]!.const === tag)!;
}

/** A value of a valid configuration, its keys in the order the schema declares them, at every depth. */
function ordered(value: unknown, node: SchemaNode): unknown {
  if (Array.isArray(value)) return value.map((item) => ordered(item, resolved(node).items!));
  if (!isRecord(value)) return value;
  const { properties = {} } = shapeOf(node, value);
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => Object.hasOwn(value, key))
      .map(([key, child]) => [key, ordered(value[key], child)]),
  );
}

/**
 * Writes a configuration as the configuration file holds it once a change of the configuration rewrote it: the same
 * document is always the same text, whatever order its keys were given in, so that the diff of the file shows
 * what changed and nothing else.
 *
 * @param document - A valid configuration.
 * @returns Its JSON, its keys in the order the schema declares them, indented by two spaces, with a final newline.
 */
export function configurationText(document: OqasConfig): string {
  return `${JSON.stringify(ordered(document, configSchema as SchemaNode), null, 2)}\n`;
}
