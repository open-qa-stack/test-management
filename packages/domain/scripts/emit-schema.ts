import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configSchema } from "../src/config/schema.ts";
import { knowledgeBaseSchema } from "../src/knowledge-base/schema.ts";
import { sourceCardSchema } from "../src/source-card/schema.ts";
import { sourceManifestSchema } from "../src/source-manifest/schema.ts";

export const SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas.schema.json", import.meta.url));
export const INDEX_SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas-knowledge-base.schema.json", import.meta.url));
export const CARD_SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas-source-card.schema.json", import.meta.url));
export const MANIFEST_SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas-source-manifest.schema.json", import.meta.url));

export function renderSchema(schema: object = configSchema): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SCHEMA_FILE, renderSchema(configSchema));
  writeFileSync(INDEX_SCHEMA_FILE, renderSchema(knowledgeBaseSchema));
  writeFileSync(CARD_SCHEMA_FILE, renderSchema(sourceCardSchema));
  writeFileSync(MANIFEST_SCHEMA_FILE, renderSchema(sourceManifestSchema));
}
