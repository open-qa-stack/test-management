import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { imageTokens, ImageToolResult, pngSize } from "../src/index.ts";

/** The first bytes of a PNG image of `width` × `height` pixels: its signature and its header. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("the size of a PNG image", () => {
  it("is read from its header, wherever its bytes start", () => {
    assert.deepEqual(pngSize(pngHeader(1280, 800)), { width: 1280, height: 800 });
    const shifted = new Uint8Array(40);
    shifted.set(pngHeader(3, 2), 7);
    assert.deepEqual(pngSize(shifted.subarray(7)), { width: 3, height: 2 });
  });

  it("is refused for bytes that are too short, without the signature, or without a header first", () => {
    const noHeader = pngHeader(1, 1);
    noHeader.set([0x49, 0x44, 0x41, 0x54], 12);
    for (const bytes of [pngHeader(1, 1).subarray(0, 23), new TextEncoder().encode("GIF89a and enough bytes after"), noHeader]) {
      assert.throws(() => pngSize(bytes), { message: "The image is not a PNG image." });
    }
  });
});

describe("the tokens of an image", () => {
  it("are one per 32 × 32 pixels, rounded up", () => {
    assert.equal(imageTokens({ width: 1280, height: 800 }), 1000);
    assert.equal(imageTokens({ width: 640, height: 400 }), 250);
    assert.equal(imageTokens({ width: 1, height: 1 }), 1);
  });
});

describe("a tool result with an image", () => {
  it("holds what the model reads, the image and its size", () => {
    const png = pngHeader(1280, 720);
    const result = new ImageToolResult({ path: "shop-1.png" }, png);
    assert.deepEqual([result.value, result.png, result.size], [{ path: "shop-1.png" }, png, { width: 1280, height: 720 }]);
  });

  it("is refused for an image that is not a PNG image", () => {
    assert.throws(() => new ImageToolResult({}, new Uint8Array(40)), { message: "The image is not a PNG image." });
  });

  it("says, without the image, why the model is not shown it", () => {
    assert.deepEqual(ImageToolResult.withheld({ path: "shop-1.png" }, "Not now."), { path: "shop-1.png", imageNotShown: "Not now." });
  });
});
