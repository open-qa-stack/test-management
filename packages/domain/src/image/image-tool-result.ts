import { pngSize, type ImageSize } from "./png-size.ts";

/** The key of a result that says why the model is not shown the image of a tool. */
const IMAGE_NOT_SHOWN = "imageNotShown";

/**
 * What a tool returns when it gives the model an image besides its result: the screenshot of a page, say.
 *
 * @remarks
 * The runtime decides whether the model sees the image: only a model that reads images does, within the
 * bounds of its session. Otherwise the model reads the result alone, with the reason under
 * `imageNotShown`.
 */
export class ImageToolResult {
  /** What the model reads, with or without the image. */
  public readonly value: Readonly<Record<string, unknown>>;
  /** The bytes of the image, a PNG image. */
  public readonly png: Uint8Array;
  /** The size of the image, read from its header. */
  public readonly size: ImageSize;

  /**
   * @param value - What the model reads, with or without the image.
   * @param png - The bytes of the image.
   * @throws Error when the bytes are not those of a PNG image.
   */
  public constructor(value: Readonly<Record<string, unknown>>, png: Uint8Array) {
    this.value = value;
    this.png = png;
    this.size = pngSize(png);
  }

  /**
   * A result whose image the model is not shown.
   *
   * @param value - What the model reads.
   * @param reason - Why it is not shown the image, written for the model.
   * @returns The value, with the reason under `imageNotShown`.
   */
  public static withheld(value: Readonly<Record<string, unknown>>, reason: string): Readonly<Record<string, unknown>> {
    return { ...value, [IMAGE_NOT_SHOWN]: reason };
  }
}
