/** The size of an image, in pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** The signature, then the length and the type of the first chunk, then the width and the height it holds. */
const HEADER_LENGTH = 24;

/**
 * Reads the size of a PNG image from its header, the `IHDR` chunk that opens it.
 *
 * @param png - The bytes of the image.
 * @returns Its width and height.
 * @throws Error when the bytes do not open with the signature and the header of a PNG image.
 */
export function pngSize(png: Uint8Array): ImageSize {
  const header = String.fromCharCode(...png.subarray(12, 16));
  if (png.length < HEADER_LENGTH || SIGNATURE.some((byte, i) => png[i] !== byte) || header !== "IHDR") throw new Error("The image is not a PNG image.");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
