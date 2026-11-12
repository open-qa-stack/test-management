import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { configSchema } from "../src/config/schema.ts";

export const SCHEMA_FILE = fileURLToPath(new URL("../schema/oqas.schema.json", import.meta.url));

export function renderSchema(): string {
  return `${JSON.stringify(configSchema, null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SCHEMA_FILE, renderSchema());
}
