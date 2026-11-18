import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { ApiError } from "../../src/api/api-error.ts";
import { poll } from "../../src/api/poll.ts";
import { FakeDocument } from "./fake-document.ts";

/** How long the polls of these tests wait between an answer and the next question, in milliseconds. */
const PAUSE_MS = 2000;

/** A question a poll asked, which a test answers when it chooses. */
interface Asked {
  readonly answer: (value: string) => void;
  readonly fail: (error: ApiError) => void;
}

/** A poll under test: the questions it asked, what it was told, and what stops it. */
interface Polling {
  readonly asked: Asked[];
  /** The answers and the messages of the failures, in the order they came. */
  readonly got: string[];
  stop: () => void;
}

/**
 * Starts a poll whose questions a test answers.
 *
 * @param told - What else to do with an answer, such as stopping the poll.
 * @returns The poll.
 */
function polling(told: (polling: Polling) => void = () => {}): Polling {
  const started: Polling = { asked: [], got: [], stop: () => {} };
  started.stop = poll(
    {
      ask: () => new Promise<string>((answer, fail) => started.asked.push({ answer, fail })),
      told: (answer) => {
        started.got.push(answer);
        told(started);
      },
      failed: (error) => started.got.push(error.message),
    },
    PAUSE_MS,
  );
  return started;
}

/** Lets the answers given so far reach the poll. */
const settled = (): Promise<unknown> => vi.advanceTimersByTimeAsync(0);

describe("a poll of the API", () => {
  let page = new FakeDocument();

  beforeEach(() => {
    page = new FakeDocument();
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("document", page);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks at once, then again a pause after each answer", async () => {
    const { asked, got } = polling();
    assert.equal(asked.length, 1);
    asked[0]!.answer("first");
    await settled();
    assert.deepEqual(got, ["first"]);
    await vi.advanceTimersByTimeAsync(PAUSE_MS - 1);
    assert.equal(asked.length, 1);
    await vi.advanceTimersByTimeAsync(1);
    assert.equal(asked.length, 2);
    asked[1]!.answer("second");
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    assert.deepEqual(got, ["first", "second"]);
    assert.equal(asked.length, 3);
  });

  it("does not ask again while a question waits for its answer, however long", async () => {
    const { asked } = polling();
    await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
    assert.equal(asked.length, 1);
  });

  it("tells a failure, and asks again a pause later", async () => {
    const { asked, got } = polling();
    asked[0]!.fail(new ApiError("L’instance ne répond pas.", 0, "unreachable"));
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    assert.deepEqual(got, ["L’instance ne répond pas."]);
    assert.equal(asked.length, 2);
  });

  it("drops an answer or a failure still on its way once stopped, and asks nothing more", async () => {
    for (const settle of [(question: Asked) => question.answer("late"), (question: Asked) => question.fail(new ApiError("late", 500, "error"))]) {
      const { asked, got, stop } = polling();
      stop();
      settle(asked[0]!);
      await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
      assert.deepEqual(got, []);
      assert.equal(asked.length, 1);
    }
    assert.equal(page.listening, 0);
  });

  it("asks nothing more once stopped during a pause, or by what it was told", async () => {
    const paused = polling();
    paused.asked[0]!.answer("first");
    await settled();
    paused.stop();
    const once = polling(({ stop }) => stop());
    once.asked[0]!.answer("only");
    await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
    assert.deepEqual([paused.asked.length, once.asked.length, once.got], [1, 1, ["only"]]);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("asks nothing while the page is hidden, and resumes at once when it shows again", async () => {
    const { asked } = polling();
    asked[0]!.answer("first");
    await settled();
    page.show(true);
    await vi.advanceTimersByTimeAsync(10 * PAUSE_MS);
    assert.equal(asked.length, 1);
    page.show(false);
    assert.equal(asked.length, 2);
  });

  it("starts hidden without asking, until the page shows", () => {
    page.hidden = true;
    const { asked } = polling();
    assert.equal(asked.length, 0);
    page.show(false);
    assert.equal(asked.length, 1);
  });

  it("asks no second question when the page shows again during a pause, or while a question waits", async () => {
    const { asked } = polling();
    page.show(true);
    page.show(false);
    assert.equal(asked.length, 1);
    asked[0]!.answer("first");
    await settled();
    page.show(true);
    page.show(false);
    assert.equal(asked.length, 1);
    await vi.advanceTimersByTimeAsync(PAUSE_MS);
    assert.equal(asked.length, 2);
  });
});
