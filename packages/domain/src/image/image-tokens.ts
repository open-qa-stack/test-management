import type { ImageSize } from "./png-size.ts";

/** Pixels a token of an image stands for: a square of 32 × 32 pixels. */
export const PIXELS_PER_TOKEN = 1024;

/**
 * What an image costs each model call that carries it, in tokens, as the harness counts it: models that
 * read images leave them out of the tokens they report.
 *
 * @param size - The size of the image.
 * @returns Its width times its height over `PIXELS_PER_TOKEN`, rounded up.
 */
export function imageTokens(size: ImageSize): number {
  return Math.ceil((size.width * size.height) / PIXELS_PER_TOKEN);
}
