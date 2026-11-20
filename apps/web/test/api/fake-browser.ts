import { afterEach, beforeEach, vi } from "vitest";
import { FakeDocument } from "./fake-document.ts";

/** Runs each test of the suite in a browser whose clock the test moves and whose page stays shown. */
export function useFakeBrowser(): void {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", new FakeDocument());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
}
