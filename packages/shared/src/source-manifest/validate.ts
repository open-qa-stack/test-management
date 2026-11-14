import { Ajv2020 } from "ajv/dist/2020.js";
import { repeated, validate } from "../domain-index/schema-validation.ts";
import type { IndexValidation } from "../domain-index/types.ts";
import { placementSubmissionSchema, sourceManifestSchema } from "./schema.ts";
import type { PlacementSubmission, SourceManifest } from "./types.ts";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const checkManifest = ajv.compile<SourceManifest>(sourceManifestSchema);
const checkPlacement = ajv.compile<PlacementSubmission>(placementSubmissionSchema);

/**
 * Validates a source manifest: the schema, then domains and elements named once, and each element in a
 * domain of the manifest.
 *
 * @param value - The manifest.
 * @returns The manifest, or every error found, each with its location.
 */
export function validateSourceManifest(value: unknown): IndexValidation<SourceManifest> {
  return validate(checkManifest, value, (manifest) => {
    const domains = manifest.domains.map((domain) => domain.id);
    const names = manifest.elements.map((element) => element.name);
    const strays = manifest.elements.flatMap((element, i) =>
      element.domain === undefined || domains.includes(element.domain)
        ? []
        : [{ path: `/elements/${i}/domain`, message: `/elements/${i}/domain names the domain ${element.domain}, which the manifest does not have.` }],
    );
    return [...repeated(domains, "/domains", "id", "domain"), ...repeated(names, "/elements", "name", "element"), ...strays];
  });
}

/**
 * Validates the shape of what the model hands in for a batch of elements; what it places is checked by the
 * harness, element by element.
 *
 * @param value - The submission, as the model wrote it.
 * @returns The submission, or every error found, each with its location.
 */
export function validatePlacementSubmission(value: unknown): IndexValidation<PlacementSubmission> {
  return validate(checkPlacement, value, () => []);
}
