import type { ElementHandle, Page } from "playwright-core";
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
  const ownCandidates: Target[] = role === "generic" ? [] : [name === "" ? { role } : { role, name }];
  const recommendation = await element
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
  await element.dispose();
  return recommendation;
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
