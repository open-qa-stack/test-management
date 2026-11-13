import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configSchema } from "../src/config/schema.ts";
import { domainIndexSchema } from "../src/domain-index/schema.ts";

export const SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas.schema.json", import.meta.url));
export const INDEX_SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas-domain-index.schema.json", import.meta.url));

export function renderSchema(schema: object = configSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SCHEMA_FILE, renderSchema(configSchema));
  writeFileSync(INDEX_SCHEMA_FILE, renderSchema(domainIndexSchema));
}
