import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, it } from "vitest";
import type { AgentEvent, AgentRuntime, AgentSession, SessionOptions } from "@open-qa-stack/domain";
import { validateConfig } from "@open-qa-stack/shared";
import { mapSources } from "../src/index.ts";

const workspace = mkdtempSync(join(tmpdir(), "oqas-concurrent-cards-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A runtime that calls no model: each session reads the source of its request, waits, hands in a card that
 * places the one section of that source, and ends with counters of its own. The waits make the sessions of
 * two sources overlap.
 */
class InterleavedRuntime implements AgentRuntime {
  public open = 0;
  public most = 0;

  public async openSession(options: SessionOptions): Promise<AgentSession> {
    this.open += 1;
    this.most = Math.max(this.most, this.open);
    return {
      async *send(message: string): AsyncIterable<AgentEvent> {
        const source = /the source ([a-z0-9-]+)/.exec(message)![1]!;
        const own = source === "alpha" ? 3 : 7;
        await pause(source === "alpha" ? 40 : 5);
        const submit = options.tools.find((tool) => tool.name === "submit_card")!;
        const card = {
          domains: [
            {
              id: source,
              label: source,
              description: `What ${source} holds.`,
              items: [{ name: source === "alpha" ? "Alpha" : "Beta", summary: `The ${source} folder.` }],
            },
          ],
          unassigned: [],
        };
        yield { type: "tool-call", callId: `${source}-1`, tool: "submit_card", arguments: card };
        await pause(source === "alpha" ? 5 : 40);
        yield { type: "tool-result", callId: `${source}-1`, tool: "submit_card", result: await submit.execute(card) };
        yield { type: "end", counters: { iterations: own, actions: own, elapsedMs: own } };
      },
      close: async () => {
        this.open -= 1;
      },
    };
  }

  public async close(): Promise<void> {}
}

describe("solo command, criterion 19 — two cartography tasks at once keep each its own events", () => {
  it("gives each card, its journal and its counters the events of its own session only", async () => {
    const root = mkdtempSync(join(workspace, "repo-"));
    // Two sources mapped with one card each: the code of two services, each with one folder.
    for (const [source, folder] of [
      ["alpha", "Alpha"],
      ["beta", "Beta"],
    ] as const) {
      mkdirSync(join(root, "code", source, folder), { recursive: true });
      writeFileSync(join(root, "code", source, folder, "index.ts"), `export const ${source} = 1;\n`);
    }
    const text = JSON.stringify({
      formatVersion: 1,
      applications: [
        {
          id: "shop",
          name: "Shop",
          type: "api",
          authentication: { method: "none" },
          environments: [{ name: "local", apis: [{ name: "b", baseUrl: "http://127.0.0.1:1" }] }],
        },
      ],
      knowledge: ["alpha", "beta"].map((id) => ({ id, type: "source-code", path: `code/${id}`, commands: "none", attachments: [{ application: "shop" }] })),
      model: { mode: "provider-key", provider: "openai", baseUrl: "http://127.0.0.1:1/v1", model: "m" },
      autonomy: { level: "autonomous" },
      cartography: { concurrency: 2 },
    });
    const config = validateConfig(text, {});
    assert.ok(config.ok);
    const runtime = new InterleavedRuntime();
    const results = await mapSources({
      config: config.config,
      environment: "local",
      repositoryRoot: root,
      env: {},
      runtime,
      concurrency: config.config.cartography.concurrency,
      now: () => new Date("2026-11-13T12:00:00.000Z"),
    });
    assert.equal(runtime.most, 2, "the two sessions overlap");
    for (const { source, outcome } of results) {
      const own = source.id === "alpha" ? 3 : 7;
      assert.deepEqual([outcome.card?.status, outcome.card?.run.iterations, outcome.card?.run.actions], ["complete", own, own], source.id);
      assert.deepEqual(
        outcome.card?.domains.map((domain) => domain.id),
        [source.id],
      );
      assert.ok(
        outcome.journal.every((entry) => entry.source === source.id),
        source.id,
      );
    }
  });
});
