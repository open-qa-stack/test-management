import type { ElementHandle, Locator, Page } from "playwright-core";
import { readFacts, sameElement, type ElementFacts } from "./element-facts.ts";
import { readScope } from "./element-scope.ts";
import { locate, type Target } from "./target.ts";

/** The locator recommended for an element, or why there is none. */
export type Recommendation =
  | { readonly kind: "unique"; readonly target: Target }
  | { readonly kind: "ambiguous"; readonly target: Target; readonly matches: number }
  | { readonly kind: "none" }
  | { readonly kind: "changed" };

/**
 * Finds the locator a test should use for an element of a snapshot.
 *
 * @remarks
 * The candidates follow the order of the Playwright documentation: role and accessible name, then label,
 * then test id, then text. The first that matches this element, and no other, is recommended. When none
 * does, they are tried again inside the closest row or dialog that holds the element, the way a
 * test finds a button repeated on each row. When none does there either, the first candidate that matches
 * several elements on the page is given with their number, so that the agent
 * knows the page lacks a robust locator for this element rather than reaching for CSS. An element the page
 * replaced while the snapshot was read is reported as changed, without failing the snapshot.
 *
 * @param page - The page the snapshot was taken on.
 * @param ref - Reference of the element in that snapshot.
 * @param role - Its role; `generic` when it has none a locator can use.
 * @param name - Its accessible name, possibly empty.
 * @returns The recommendation.
 */
export async function recommendTarget(page: Page, ref: string, role: string, name: string): Promise<Recommendation> {
  const [element] = await page
    .getByRef(ref)
    .elementHandles()
    .catch((): ElementHandle[] => []);
  if (element === undefined) return { kind: "changed" };
  const recommendation = await recommendElement(page, element, role === "generic" ? [] : [name === "" ? { role } : { role, name }]);
  await element.dispose();
  return recommendation;
}

/**
 * Whether a locator permitted by the test charter tells apart each element a locator matches several of: for
 * one of them at least, a candidate of `recommendTarget` designates it alone. When none does, the page gives
 * them no label of their own, no test id and no part that holds one alone.
 *
 * @param page - The page.
 * @param target - The target that matched several elements.
 * @param found - The locator of that target.
 * @returns `true` when one of the elements has a locator of its own.
 */
export async function distinguishable(page: Page, target: Target, found: Locator): Promise<boolean> {
  const own = { ...target };
  delete (own as { within?: unknown }).within;
  const elements = await found.elementHandles();
  let told = false;
  for (const element of elements) {
    if (!told) told = (await recommendElement(page, element, [own])).kind === "unique";
    await element.dispose();
  }
  return told;
}

/** The locator recommended for an element: its own candidates, then those of its facts, alone then inside its part. */
async function recommendElement(page: Page, element: ElementHandle, ownCandidates: readonly Target[]): Promise<Recommendation> {
  return element
    .evaluate(readFacts)
    .then(async (facts) => {
      const candidates = [...ownCandidates, ...factTargets(facts)];
      const found = await firstUnique(page, element, candidates);
      if (found.kind !== "ambiguous") return found;
      const scope = await element.evaluate(readScope);
      if (scope === null) return found;
      const scoped = await firstUnique(
        page,
        element,
        candidates.map((target) => ({ ...target, within: scope })),
      );
      return scoped.kind === "unique" ? scoped : found;
    })
    .catch((): Recommendation => ({ kind: "changed" }));
}

/** The first candidate that locates this element and no other, else the first that matches several. */
async function firstUnique(page: Page, element: ElementHandle, candidates: readonly Target[]): Promise<Recommendation> {
  let ambiguous: Recommendation = { kind: "none" };
  for (const target of candidates) {
    const found = locate(page, target);
    const matches = await found.count();
    if (matches === 1 && (await found.evaluate(sameElement, element))) return { kind: "unique", target };
    if (ambiguous.kind === "none" && matches > 1) ambiguous = { kind: "ambiguous", target, matches };
  }
  return ambiguous;
}

function factTargets({ testId, label, text }: ElementFacts): Target[] {
  return [...(label === null ? [] : [{ label }]), ...(testId === null ? [] : [{ testId }]), ...(text === "" ? [] : [{ text }])];
}
