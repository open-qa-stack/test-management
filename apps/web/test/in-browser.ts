import assert from "node:assert/strict";
import type { Locator, Page } from "playwright-core";
import { afterAll, beforeAll } from "vitest";
import { SESSION_ID } from "./agent/session-fixture.ts";
import { BuiltConsole } from "./built-console.ts";

/**
 * Builds the console once for the tests of a file, and stops it after them.
 *
 * @returns What gives the built console to a test.
 */
export function builtConsole(): () => BuiltConsole {
  let built: BuiltConsole | undefined;
  beforeAll(async () => {
    built = await BuiltConsole.start();
  });
  afterAll(async () => {
    await built?.stop();
  });
  return () => {
    assert.ok(built, "the console is built");
    return built;
  };
}

/** The address of the session of the fixtures. */
export const SESSION = `#/agent/sessions/${SESSION_ID}`;

/** The address of that session with the look of the page its planner opened, the seventh step of its thread. */
export const LOOKED = `${SESSION}?look=6`;

/** The least side of what a finger presses, in CSS pixels. */
export const TAP = 44;

/**
 * Tells how far a page is wider than its window.
 *
 * @param page - The page.
 * @returns The width that overflows, in CSS pixels; none when the page fits.
 */
export function overflowOf(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Lists what a person can press on a page that a finger would miss.
 *
 * @param page - The page.
 * @returns Each link, button, folded block and field shown that is less than 44 px wide or high, with its size,
 * read to the hundredth of a pixel: a box laid out at a fraction of a pixel is not measured exactly.
 */
export function tooSmallOf(page: Page): Promise<string[]> {
  return page.evaluate(
    (least) =>
      [...document.querySelectorAll("a, button, summary, textarea")]
        .filter((element) => element.checkVisibility())
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => Math.round(box.width * 100) < least * 100 || Math.round(box.height * 100) < least * 100)
        .map(({ element, box }) => `${element.tagName} « ${element.getAttribute("aria-label") ?? element.textContent} » ${box.width} × ${box.height}`),
    TAP,
  );
}

/**
 * Names what holds the focus of a page.
 *
 * @param page - The page.
 * @returns Its tag and what it reads as, by its label or its text; `nothing` when the focus is on no element.
 */
export function focusedOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element === null || element === document.body ? "nothing" : `${element.tagName}: ${element.getAttribute("aria-label") ?? element.textContent}`;
  });
}

/**
 * Waits until what slides an element into place has ended, so that it is measured where it stays.
 *
 * @param element - The element.
 */
export async function settled(element: Locator): Promise<void> {
  await element.evaluate((moving) => Promise.all(moving.getAnimations().map((animation) => animation.finished)));
}
