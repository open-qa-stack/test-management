import type { CodeColours } from "./code-colours.ts";

/**
 * What colours code, once it is loaded: it is loaded the first time something that draws code subscribes, and
 * whoever subscribed is told when it is there. Until then, and if it cannot be loaded, code is drawn plain.
 */
export class CodeColoursStore {
  readonly #load: () => Promise<CodeColours>;
  readonly #listeners = new Set<() => void>();
  #started = false;
  #colours: CodeColours | undefined;

  /** @param load - Loads what colours code. */
  constructor(load: () => Promise<CodeColours>) {
    this.#load = load;
  }

  /**
   * Listens for the moment code can be coloured, and starts loading what colours it the first time.
   *
   * @param listener - Told once it is loaded.
   * @returns What stops listening.
   */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    if (!this.#started) {
      this.#started = true;
      void this.#load().then(
        (loaded) => {
          this.#colours = loaded;
          for (const told of this.#listeners) told();
        },
        // Plain code says the same: a console that could not load the colours draws it so.
        () => undefined,
      );
    }
    return () => this.#listeners.delete(listener);
  };

  /** @returns What colours code, once loaded. */
  readonly snapshot = (): CodeColours | undefined => this.#colours;
}
