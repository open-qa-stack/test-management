import { ImageToolResult } from "@open-qa-stack/domain";

/**
 * Images a session shows its model, at most: an image stays in the conversation, and goes again with
 * every later call to the model, until the session ends.
 */
export const MAX_SESSION_IMAGES = 3;
/** Longest side of an image the model is shown, in pixels: the Copilot SDK reduces a larger one. */
export const MAX_IMAGE_SIDE = 2000;
/** Most bytes of an image the model is shown: the Copilot SDK reduces a larger one. */
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** An image as the model runtime sends it: a PNG image in base64. */
export interface EncodedImage {
  readonly mimeType: "image/png";
  readonly data: string;
}

/**
 * What the model and the events of the session are given for the result of a tool: the `result` the model
 * reads and the `tool-result` event reports, an image by its type and size only; and the `image` the model
 * is shown besides, if any.
 */
export type ShownResult = { readonly result: unknown } | { readonly result: unknown; readonly image: EncodedImage };

/**
 * Decides which images of the tools of a session its model is shown.
 *
 * @remarks
 * A model that does not read images is shown none. One that does is shown the first `MAX_SESSION_IMAGES`
 * that the SDK sends as they are, at most `MAX_IMAGE_SIDE` pixels a side and `MAX_IMAGE_BYTES` bytes; for
 * any other, the result says why its image is not shown, and the model reads it alone.
 */
export class SessionImages {
  private readonly vision: boolean;
  private shown = 0;

  /** @param vision - Whether the model of the session reads images. */
  public constructor(vision: boolean) {
    this.vision = vision;
  }

  /**
   * What the model and the events are given for a result, the images already recorded considered.
   *
   * @param result - What the tool returned.
   * @returns The result itself, unless it is an `ImageToolResult`: then its value, with the type and size of
   * its image when the model is shown it, or the reason it is not.
   */
  public shownResult(result: unknown): ShownResult {
    if (!(result instanceof ImageToolResult)) return { result };
    const withheld = (reason: string): ShownResult => ({ result: ImageToolResult.withheld(result.value, reason) });
    if (!this.vision) return withheld("The model of this session does not read images.");
    const { width, height } = result.size;
    if (Math.max(width, height) > MAX_IMAGE_SIDE || result.png.length > MAX_IMAGE_BYTES) {
      const bounds = `${MAX_IMAGE_SIDE} pixels a side and ${MAX_IMAGE_BYTES} bytes`;
      return withheld(
        `The image is ${width} × ${height} pixels and ${result.png.length} bytes, more than the ${bounds} shown whole: capture the viewport or one element.`,
      );
    }
    if (this.shown >= MAX_SESSION_IMAGES) return withheld(`The task already holds ${MAX_SESSION_IMAGES} images, the most it may: this one is not shown.`);
    return {
      result: { ...result.value, image: { mimeType: "image/png", width, height } },
      image: { mimeType: "image/png", data: Buffer.from(result.png).toString("base64") },
    };
  }

  /**
   * Counts the image of a result the model is given against `MAX_SESSION_IMAGES`.
   *
   * @param shown - What `shownResult` gave for it, and the model is given.
   */
  public record(shown: ShownResult): void {
    if ("image" in shown) this.shown++;
  }
}
