import type { ErrorObject } from "ajv/dist/2020.js";
import { ENV_VAR_PATTERN } from "./schema.ts";
import type { ConfigError } from "./types.ts";

export function configError(kind: ConfigError["kind"], path: string, rule: string, message: string): ConfigError {
  return { kind, path, rule, message };
}

/** Appends a segment to a JSON Pointer (RFC 6901). */
export function pointer(base: string, segment: string | number): string {
  return `${base}/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

const BY_KEYWORD: Readonly<Record<string, readonly [rule: string, message: string]>> = {
  type: ["wrong-type", "Unexpected type."],
  enum: ["unknown-variant", "Unsupported value."],
  minItems: ["too-few-items", "Too few items."],
  minLength: ["empty-value", "Expected a non-empty value."],
  minimum: ["below-minimum", "Value below the minimum."],
};

/**
 * Translates an Ajv error into a configuration error. Messages are fixed texts: they may name a key
 * the schema defines, never a value or a key read from the file.
 */
export function structureError(e: ErrorObject): ConfigError {
  const params = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "additionalProperties":
      return configError("structure", pointer(e.instancePath, String(params["additionalProperty"])), "unknown-key", "Unknown key.");
    case "required": {
      const key = String(params["missingProperty"]);
      return configError("structure", pointer(e.instancePath, key), "required", `Missing required key "${key}".`);
    }
    case "discriminator": {
      const path = pointer(e.instancePath, String(params["tag"]));
      return params["error"] === "tag"
        ? configError("structure", path, "required", `Missing required key "${String(params["tag"])}".`)
        : configError("structure", path, "unknown-variant", "Unsupported value.");
    }
    // `formatVersion` is the only `const` checked on its own: the others are discriminator tags.
    case "const":
      return configError("structure", e.instancePath, "format-version", "Unsupported format version; expected 1.");
    case "pattern":
      return params["pattern"] === ENV_VAR_PATTERN
        ? configError(
            "structure",
            e.instancePath,
            "env-var-name",
            "Expected the name of an environment variable (upper case letters, digits and underscores).",
          )
        : configError("structure", e.instancePath, "slug", "Expected lower case letters and digits separated by hyphens.");
    case "oneOf":
      return configError("structure", e.instancePath, "openapi-source", 'Declare exactly one of "url" or "path".');
    default: {
      const [rule, message] = BY_KEYWORD[e.keyword] ?? [e.keyword, "Invalid value."];
      return configError("structure", e.instancePath, rule, message);
    }
  }
}
