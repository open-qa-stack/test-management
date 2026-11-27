import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { hearShortcuts } from "../../src/ui/shortcuts.ts";

/** A page that hears the keys pressed, on an element that is in a field or a dialog or not, under an open dialog or not. */
class Keyed extends EventTarget {
  dialog = false;

  querySelector(): object | null {
    return this.dialog ? {} : null;
  }

  /** Presses a key, and tells whether something did what it is for. */
  press(key: string, more: Record<string, unknown> = {}, inField = false): boolean {
    const event = new Event("keydown", { cancelable: true });
    for (const [name, value] of Object.entries({ key, ...more })) Object.defineProperty(event, name, { value });
    Object.defineProperty(event, "target", { value: { closest: () => (inField ? {} : null) } });
    return !this.dispatchEvent(event);
  }
}

describe("the shortcuts of a page", () => {
  it("do what each key is for, a letter in either case, and nothing once they are no longer heard", () => {
    const page = new Keyed();
    const done: string[] = [];
    const stop = hearShortcuts(page as unknown as Document, { r: () => done.push("r"), ArrowLeft: () => done.push("left") });
    assert.deepEqual([page.press("r"), page.press("R"), page.press("ArrowLeft"), page.press("x"), page.press("toString")], [true, true, true, false, false]);
    stop();
    assert.equal(page.press("r"), false);
    assert.deepEqual(done, ["r", "r", "left"]);
  });

  it("hear a sign typed with Shift, as many keyboards type it, but no letter nor named key with Shift", () => {
    const page = new Keyed();
    const done: string[] = [];
    hearShortcuts(page as unknown as Document, { "?": () => done.push("?"), r: () => done.push("r"), ArrowLeft: () => done.push("left") });
    assert.deepEqual(
      [page.press("?", { shiftKey: true }), page.press("?"), page.press("R", { shiftKey: true }), page.press("ArrowLeft", { shiftKey: true })],
      [true, true, false, false],
    );
    assert.deepEqual(done, ["?", "?"]);
  });

  it("leave the key to a field, a dialog, the browser and what handled it already, and do not repeat for a key held down", () => {
    const page = new Keyed();
    const done: string[] = [];
    hearShortcuts(page as unknown as Document, { r: () => done.push("r") });
    for (const held of ["altKey", "ctrlKey", "metaKey", "shiftKey", "repeat", "defaultPrevented"]) page.press("r", { [held]: true });
    page.press("r", {}, true);
    page.dialog = true;
    page.press("r");
    assert.deepEqual(done, []);
  });
});
