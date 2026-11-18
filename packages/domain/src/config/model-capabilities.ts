import type { Model } from "./types.ts";

/**
 * Whether the configuration declares that the model reads images.
 *
 * @param model - The model of the configuration.
 * @returns `true` when its capabilities include `vision`.
 */
export function readsImages(model: Model): boolean {
  return model.capabilities?.includes("vision") === true;
}
