/** The document of a browser, as far as a poll uses it: whether the page is hidden, and who listens to it showing again. */
export class FakeDocument {
  public hidden = false;
  readonly #listeners = new Set<() => void>();

  /** How many listeners wait for the page to show or hide. */
  public get listening(): number {
    return this.#listeners.size;
  }

  /** Listens to the page showing or hiding. */
  public addEventListener(_type: "visibilitychange", listener: () => void): void {
    this.#listeners.add(listener);
  }

  /** Stops listening to it. */
  public removeEventListener(_type: "visibilitychange", listener: () => void): void {
    this.#listeners.delete(listener);
  }

  /**
   * Hides the page, or shows it again, and tells who listens.
   *
   * @param hidden - Whether the page is now hidden.
   */
  public show(hidden: boolean): void {
    this.hidden = hidden;
    for (const listener of this.#listeners) listener();
  }
}
