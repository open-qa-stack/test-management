import { Ajv2020 } from "ajv/dist/2020.js";
import { repeated, validate } from "../domain-index/schema-validation.ts";
import type { IndexValidation } from "../domain-index/types.ts";
import { sourceManifestSchema } from "./schema.ts";
import type { SourceManifest } from "./types.ts";

const check = new Ajv2020({ allErrors: true, strict: true }).compile<SourceManifest>(sourceManifestSchema);

/**
 * Validates a source manifest: the schema, then elements named once.
 *
 * @param value - The manifest.
 * @returns The manifest, or every error found, each with its location.
 */
export function validateSourceManifest(value: unknown): IndexValidation<SourceManifest> {
  return validate(check, value, (manifest) =>
    repeated(
      manifest.elements.map((element) => element.name),
      "/elements",
      "name",
      "element",
    ),
  );
}
