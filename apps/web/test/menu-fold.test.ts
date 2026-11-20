import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { keepMenuFold, MENU_FOLD_KEY, readMenuFold } from "../src/shell/menu-fold.ts";

/** A storage of the browser, kept in a map. */
function kept(): { readonly values: Map<string, string>; readonly storage: () => Pick<Storage, "getItem" | "setItem"> } {
  const values = new Map<string, string>();
  return { values, storage: () => ({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) }) };
}

/** A browser that keeps nothing: reaching its storage throws, as in a private window. */
const refused = (): never => {
  throw new Error("The storage is refused.");
};

describe("the fold of the menu, as the browser keeps it", () => {
  it("is unfolded until the person folds it, then kept folded or unfolded for the next visit", () => {
    const { values, storage } = kept();
    assert.equal(readMenuFold(storage), false);
    keepMenuFold(storage, true);
    assert.deepEqual([values.get(MENU_FOLD_KEY), readMenuFold(storage)], ["folded", true]);
    keepMenuFold(storage, false);
    assert.deepEqual([values.get(MENU_FOLD_KEY), readMenuFold(storage)], ["unfolded", false]);
  });

  it("is unfolded in a browser that keeps nothing, which forgets it without failing", () => {
    assert.equal(readMenuFold(refused), false);
    assert.doesNotThrow(() => keepMenuFold(refused, true));
  });
});
