/** A tree of elements, under the root of a document or a shadow root, as `renderedText` reads it; the package is typed without the DOM library. */
export interface PageTree {
  /** Every element of the tree; those of the shadow roots it holds are not among them. */
  querySelectorAll(selectors: "*"): ArrayLike<{ readonly shadowRoot: ShadowTree | null }>;
}

/** An open shadow root, as `renderedText` reads it. */
export interface ShadowTree extends PageTree {
  /** The text of its nodes. */
  readonly textContent: string;
}

/** The root element of a document, as `renderedText` reads it. */
export interface PageRoot extends PageTree {
  /** The document, and its body if it has one. */
  readonly ownerDocument: { readonly body: { readonly innerText: string } | null };
}

/**
 * Reads the text a document shows: the rendered text of its body, then the text of each open shadow root,
 * those inside a shadow root included, which the text of the body leaves out. Runs in the page.
 *
 * @param root - The root element of the document.
 * @returns The texts, a line apart.
 */
export function renderedText(root: PageRoot): string {
  const shadows = (tree: PageTree): string[] =>
    Array.from(tree.querySelectorAll("*")).flatMap(({ shadowRoot }) => (shadowRoot === null ? [] : [shadowRoot.textContent, ...shadows(shadowRoot)]));
  return [root.ownerDocument.body?.innerText ?? "", ...shadows(root)].join("\n");
}
