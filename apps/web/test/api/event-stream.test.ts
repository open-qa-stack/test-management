import assert from "node:assert/strict";
import type { SessionEvent } from "@open-qa-stack/domain/sessions";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { followEvents, GATHER_MS, LONGEST_RETRY_MS, RETRY_MS, type StreamState } from "../../src/api/event-stream.ts";
import { EVENTS, numbered, SESSION_ID, type EventBody } from "../agent/session-fixture.ts";
import { FakeEventSource } from "./fake-event-source.ts";

/** The address of the stream of the session of the fixtures. */
const STREAM = `/api/sessions/${SESSION_ID}/events`;

/**
 * The event that says the session of the fixtures changed state, after the three first of them.
 *
 * @param state - The state, which a later version of the API may be alone to know.
 * @returns The event.
 */
const stateChanged = (state: string): SessionEvent => numbered([...EVENTS.slice(0, 3), { type: "state_changed", state } as EventBody])[3]!;

/** What a stream told whoever follows it. */
interface Told {
  /** The batches of events, in order. */
  readonly batches: (readonly SessionEvent[])[];
  /** The states, in order. */
  readonly states: StreamState[];
}

/**
 * Follows a session with a listener that records.
 *
 * @param id - The identifier of the session; the one of the fixtures by default.
 * @returns The source the stream opened, what it told, and what stops it.
 */
function follow(id: string = SESSION_ID): { readonly source: FakeEventSource; readonly told: Told; readonly stop: () => void } {
  const told: Told = { batches: [], states: [] };
  const stop = followEvents(id, { events: (events) => told.batches.push(events), state: (state) => told.states.push(state) });
  return { source: FakeEventSource.last, told, stop };
}

describe("the stream of the events of a session", () => {
  beforeEach(() => {
    FakeEventSource.opened.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("reads the events of the session under the API, its identifier encoded", () => {
    assert.equal(follow().source.url, STREAM);
    assert.equal(follow("a/b c?d").source.url, "/api/sessions/a%2Fb%20c%3Fd/events");
    assert.equal(FakeEventSource.opened.length, 2);
  });

  it("is open once the source opened, and reconnecting after a cut", () => {
    const { source, told } = follow();
    assert.deepEqual(told.states, []);
    source.onopen?.();
    source.onerror?.();
    assert.deepEqual(told.states, ["open", "reconnecting"]);
    assert.deepEqual(told.batches, []);
  });

  it("connects again by itself after a cut the browser would not recover from, and is open again", () => {
    const { source, told } = follow();
    source.onerror?.();
    assert.equal(source.closed, true);
    vi.advanceTimersByTime(RETRY_MS - 1);
    assert.equal(FakeEventSource.opened.length, 1);
    vi.advanceTimersByTime(1);
    assert.equal(FakeEventSource.opened.length, 2);
    assert.equal(FakeEventSource.last.url, STREAM);
    FakeEventSource.last.onopen?.();
    assert.deepEqual(told.states, ["reconnecting", "open"]);
  });

  it("asks a new connection for the events after the last it received, and hands over none twice", () => {
    const { source, told } = follow();
    source.receive(EVENTS[0]!);
    source.receive(EVENTS[1]!);
    source.onerror?.();
    vi.advanceTimersByTime(RETRY_MS);
    assert.equal(FakeEventSource.last.url, `${STREAM}?after=2`);
    FakeEventSource.last.receive(EVENTS[2]!);
    vi.advanceTimersByTime(GATHER_MS);
    assert.deepEqual(told.batches, [[EVENTS[0], EVENTS[1]], [EVENTS[2]]]);
  });

  it("waits twice as long after each cut in a row, up to a limit, and as little as at first once events come again", () => {
    follow();
    const waits: number[] = [];
    for (let cut = 0; cut < 7; cut += 1) {
      const opened = FakeEventSource.opened.length;
      FakeEventSource.last.onerror?.();
      let waited = 0;
      while (FakeEventSource.opened.length === opened) {
        vi.advanceTimersByTime(RETRY_MS / 2);
        waited += RETRY_MS / 2;
      }
      waits.push(waited);
    }
    assert.deepEqual(waits, [500, 1000, 2000, 4000, LONGEST_RETRY_MS, LONGEST_RETRY_MS, LONGEST_RETRY_MS]);
    FakeEventSource.last.receive(EVENTS[0]!);
    FakeEventSource.last.onerror?.();
    vi.advanceTimersByTime(RETRY_MS);
    assert.equal(FakeEventSource.opened.length, 9);
  });

  it("ends for good on the event that says the session no longer goes on, handing over at once what it gathered", () => {
    for (const state of ["completed", "interrupted", "archived"]) {
      const { source, told } = follow();
      const opened = FakeEventSource.opened.length;
      source.onopen?.();
      source.receive(EVENTS[0]!);
      source.receive(stateChanged(state));
      assert.deepEqual(told.batches, [[EVENTS[0], stateChanged(state)]], state);
      assert.deepEqual(told.states, ["open", "ended"], state);
      assert.equal(source.closed, true, state);
      vi.advanceTimersByTime(10 * LONGEST_RETRY_MS);
      assert.equal(FakeEventSource.opened.length, opened, state);
      assert.equal(told.batches.length, 1, state);
      assert.equal(vi.getTimerCount(), 0, state);
    }
  });

  it("goes on after the event that says the session waits its turn, or runs", () => {
    for (const state of ["queued", "running"]) {
      const { source, told } = follow();
      source.receive(stateChanged(state));
      vi.advanceTimersByTime(GATHER_MS);
      assert.deepEqual(told.states, [], state);
      assert.equal(source.closed, false, state);
      assert.equal(told.batches.length, 1, state);
    }
  });

  it("ignores a frame that is not an event", () => {
    const { source, told } = follow();
    for (const data of ["", "not json", "null", "42", '"text"', "[]", '{"type":"note"}', '{"id":"7","type":"note"}', '{"id":7}', '{"id":7,"type":9}']) {
      source.onmessage?.({ data });
    }
    source.receive(EVENTS[0]!);
    vi.advanceTimersByTime(GATHER_MS);
    assert.deepEqual(told.batches, [[EVENTS[0]]]);
    source.onerror?.();
    vi.advanceTimersByTime(RETRY_MS);
    assert.equal(FakeEventSource.last.url, `${STREAM}?after=1`);
  });

  it("gathers the events that come close together, and hands them over at once, in order", () => {
    const { source, told } = follow();
    source.receive(EVENTS[0]!);
    vi.advanceTimersByTime(GATHER_MS - 1);
    source.receive(EVENTS[1]!);
    assert.deepEqual(told.batches, []);
    vi.advanceTimersByTime(1);
    assert.deepEqual(told.batches, [[EVENTS[0], EVENTS[1]]]);
  });

  it("hands over the events that come later in a batch of their own", () => {
    const { source, told } = follow();
    source.receive(EVENTS[0]!);
    vi.advanceTimersByTime(GATHER_MS);
    source.receive(EVENTS[1]!);
    source.receive(EVENTS[2]!);
    vi.advanceTimersByTime(GATHER_MS - 1);
    assert.equal(told.batches.length, 1);
    vi.advanceTimersByTime(1);
    assert.deepEqual(told.batches, [[EVENTS[0]], [EVENTS[1], EVENTS[2]]]);
    vi.advanceTimersByTime(10 * GATHER_MS);
    assert.equal(told.batches.length, 2);
  });

  it("closes its source once stopped, and hands over nothing it was still gathering", () => {
    const { source, told, stop } = follow();
    source.receive(EVENTS[0]!);
    assert.equal(source.closed, false);
    stop();
    assert.equal(source.closed, true);
    vi.advanceTimersByTime(10 * GATHER_MS);
    assert.deepEqual(told.batches, []);
    assert.equal(vi.getTimerCount(), 0);
  });

  it("stops without anything to hand over", () => {
    const { source, told, stop } = follow();
    stop();
    assert.equal(source.closed, true);
    assert.deepEqual(told, { batches: [], states: [] });
  });

  it("does not connect again once stopped while it waited to", () => {
    const { source, stop } = follow();
    source.onerror?.();
    stop();
    vi.advanceTimersByTime(10 * LONGEST_RETRY_MS);
    assert.equal(FakeEventSource.opened.length, 1);
    assert.equal(vi.getTimerCount(), 0);
  });
});
