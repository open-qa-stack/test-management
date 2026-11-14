import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ImageToolResult, pngSize, type AgentEvent, type TaskLimits, type ToolDefinition } from "@open-qa-stack/domain";
import { answer, scriptedServer, testSite, toolCalls } from "@open-qa-stack/testing";
import { browserTools } from "@open-qa-stack/tools";
import { visionCapability } from "../src/copilot/copilot-agent-runtime.ts";
import { TaskBudget } from "../src/guardrails/task-budget.ts";
import { canonicalRequest, describeRequest, imageTokensOf } from "../src/model-gateway/canonical-request.ts";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MAX_SESSION_IMAGES, SessionImages } from "../src/tools/session-images.ts";
import { parseRecording } from "../src/index.ts";
import { ManualClock, SCENARIOS, SCREENSHOT, screenshot } from "./scenarios.ts";
import { exchange, loadRecording, MODEL, png, RECORDINGS, withRuntime } from "./support.ts";

type WireMessage = { role: string; content: unknown };
type WirePart = { type: string; text?: string; image_url?: { url: string } };

/** The images of the messages of a request the scripted model server received, as their bytes. */
function imagesOf(body: unknown): Buffer[] {
  const parts = (body as { messages: WireMessage[] }).messages.flatMap((m) => (Array.isArray(m.content) ? (m.content as WirePart[]) : []));
  return parts.filter((p) => p.type === "image_url").map((p) => Buffer.from(p.image_url!.url.replace(/^data:image\/png;base64,/, ""), "base64"));
}

/** The content of the tool messages of a request the scripted model server received. */
function toolMessages(body: unknown): unknown[] {
  return (body as { messages: WireMessage[] }).messages.filter((m) => m.role === "tool").map((m) => m.content);
}

const results = (events: readonly AgentEvent[]) => events.flatMap((e) => (e.type === "tool-result" ? [e.result] : []));
const SHOWN = { mimeType: "image/png", width: 1280, height: 800 };
const UNBOUNDED: TaskLimits = { maxIterations: null, maxDurationMs: null, maxActions: null };

describe("criterion 1 — without vision, the session declares nothing and the model reads the result alone", () => {
  it("declares that the model reads images only with vision", () => {
    assert.deepEqual(visionCapability(false), {});
    assert.deepEqual(visionCapability(true), { modelCapabilities: { supports: { vision: true } } });
  });

  it("sends no image to a model that does not read them, and says why in the result", async () => {
    const server = await scriptedServer([{ body: toolCalls(MODEL, [{ id: "s1", name: "app_screenshot", arguments: {} }]) }, { body: answer(MODEL, "Done.") }]);
    try {
      const events = await withRuntime({ kind: "live", upstream: { baseUrl: server.baseUrl } }, MODEL, (runtime) =>
        exchange(runtime, { instructions: "Explore.", tools: [screenshot(new Map())] }, "Go."),
      );
      const withheld = { path: "app-1.png", imageNotShown: "The model of this session does not read images." };
      assert.deepEqual(results(events), [withheld]);
      assert.deepEqual(imagesOf(server.requests[1]!.body), []);
      assert.deepEqual(toolMessages(server.requests[1]!.body), [JSON.stringify({ result: withheld })]);
    } finally {
      await server.close();
    }
  });
});

describe("criterion 2 — with vision, a screenshot reaches the model with its type and size, not reduced", () => {
  it("replays a session whose model is shown the screenshot of a page of 1280 × 800 pixels", async () => {
    const scenario = SCENARIOS["screenshot-vision.json"]!;
    const recording = loadRecording("screenshot-vision.json");
    const events = await withRuntime(
      { kind: "replay", recording },
      MODEL,
      (runtime) => exchange(runtime, scenario.session(new ManualClock(), new Map()), scenario.message),
      undefined,
      true,
    );
    assert.deepEqual(results(events), [{ path: "app-1.png", image: SHOWN }]);
    assert.deepEqual(events.at(-1), { type: "end" });
    const sent = recording.exchanges[1]!.request.messages.at(-1);
    const sha256 = createHash("sha256").update(SCREENSHOT).digest("hex");
    assert.deepEqual(sent, {
      role: "user",
      content: [
        { type: "text", text: "Here is a screenshot:" },
        { type: "image", sha256, ...SHOWN },
      ],
    });
  });

  it("sends the screenshot of an example page whole, at the 1280 pixels of the width of the browser", async () => {
    const site = await testSite({ "/": "<h1>Policies</h1><button><svg width='16' height='16'><circle cx='8' cy='8' r='6'/></svg></button>" });
    const server = await scriptedServer([
      { body: toolCalls(MODEL, [{ id: "s1", name: "shop_screenshot", arguments: {} }]) },
      { body: answer(MODEL, "An icon.") },
    ]);
    const folder = mkdtempSync(join(tmpdir(), "oqas-shots-"));
    const application = {
      id: "shop",
      name: "Shop",
      type: "web" as const,
      authentication: { method: "none" as const },
      environments: [{ name: "local", uiUrl: site.origin }],
    };
    const toolset = browserTools([application], { environment: "local", env: {}, screenshotsDir: folder, vision: true });
    try {
      const events = await withRuntime(
        { kind: "live", upstream: { baseUrl: server.baseUrl } },
        MODEL,
        (runtime) => exchange(runtime, { instructions: "Explore.", tools: toolset.tools }, "Look at the page."),
        undefined,
        true,
      );
      const [image] = imagesOf(server.requests[1]!.body);
      assert.deepEqual(image, readFileSync(join(folder, "shop-1.png")));
      assert.deepEqual(pngSize(image!), { width: 1280, height: 720 });
      assert.deepEqual(results(events), [{ path: join(folder, "shop-1.png"), image: { mimeType: "image/png", width: 1280, height: 720 } }]);
    } finally {
      await toolset.close();
      await server.close();
      await site.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe(`the images the SDK would reduce — larger than ${MAX_IMAGE_SIDE} pixels a side or ${MAX_IMAGE_BYTES} bytes — are not shown`, () => {
  /** A tool that gives the model the image of each size it is called with, in order. */
  const sized = (sizes: readonly (readonly [number, number])[]): ToolDefinition => {
    let taken = 0;
    return {
      name: "app_screenshot",
      description: "Saves a screenshot of the page and returns where it is, with the image.",
      parameters: { type: "object" },
      execute: () => {
        const [width, height] = sizes[taken++]!;
        return Promise.resolve(new ImageToolResult({ path: `app-${taken}.png` }, png(width, height)));
      },
    };
  };

  it("sends an image of the longest side whole, and gives the path alone for a longer one, with the reason", async () => {
    const calls = [1, 2].map((i) => ({ id: `s${i}`, name: "app_screenshot", arguments: {} }));
    const server = await scriptedServer([...calls.map((call) => ({ body: toolCalls(MODEL, [call]) })), { body: answer(MODEL, "Done.") }]);
    try {
      const tool = sized([
        [1280, MAX_IMAGE_SIDE],
        [1280, MAX_IMAGE_SIDE + 1],
      ]);
      const events = await withRuntime(
        { kind: "live", upstream: { baseUrl: server.baseUrl } },
        MODEL,
        (runtime) => exchange(runtime, { instructions: "Explore.", tools: [tool] }, "Go."),
        undefined,
        true,
      );
      const bytes = png(1280, MAX_IMAGE_SIDE + 1).length;
      const reason = `The image is 1280 × 2001 pixels and ${bytes} bytes, more than the 2000 pixels a side and 3145728 bytes shown whole: capture the viewport or one element.`;
      assert.deepEqual(results(events), [
        { path: "app-1.png", image: { mimeType: "image/png", width: 1280, height: MAX_IMAGE_SIDE } },
        { path: "app-2.png", imageNotShown: reason },
      ]);
      const sent = imagesOf(server.requests.at(-1)!.body);
      assert.deepEqual(sent, [png(1280, MAX_IMAGE_SIDE)]);
    } finally {
      await server.close();
    }
  });

  it("gives the path alone for an image of more bytes, and counts no image it does not give", () => {
    const heavy = Buffer.concat([png(1280, 800), Buffer.alloc(MAX_IMAGE_BYTES)]);
    const images = new SessionImages(true);
    const result = images.shownResult(new ImageToolResult({ path: "a.png" }, heavy));
    assert.ok(!("image" in result));
    assert.match((result.result as { imageNotShown: string }).imageNotShown, /^The image is 1280 × 800 pixels and \d+ bytes, more than/);
    images.record(result);
    const shot = new ImageToolResult({ path: "b.png" }, png(1280, 800));
    for (let i = 0; i < MAX_SESSION_IMAGES; i++) {
      assert.ok("image" in images.shownResult(shot), "asking does not count");
      images.record(images.shownResult(shot));
    }
    assert.ok(!("image" in images.shownResult(shot)));
  });
});

describe(`criterion 4 — a task shows its model ${MAX_SESSION_IMAGES} images at most, then the path alone, with a warning`, () => {
  it("withholds the image past the bound, and says why", async () => {
    const calls = Array.from({ length: MAX_SESSION_IMAGES + 1 }, (_, i) => ({ id: `s${i + 1}`, name: "app_screenshot", arguments: {} }));
    const server = await scriptedServer([...calls.map((call) => ({ body: toolCalls(MODEL, [call]) })), { body: answer(MODEL, "Done.") }]);
    try {
      const events = await withRuntime(
        { kind: "live", upstream: { baseUrl: server.baseUrl } },
        MODEL,
        (runtime) => exchange(runtime, { instructions: "Explore.", tools: [screenshot(new Map())] }, "Go."),
        undefined,
        true,
      );
      const warning = `The task already holds ${MAX_SESSION_IMAGES} images, the most it may: this one is not shown.`;
      assert.deepEqual(results(events), [
        ...calls.slice(0, -1).map((_, i) => ({ path: `app-${i + 1}.png`, image: SHOWN })),
        { path: `app-${calls.length}.png`, imageNotShown: warning },
      ]);
      assert.equal(imagesOf(server.requests.at(-1)!.body).length, MAX_SESSION_IMAGES);
      assert.equal(toolMessages(server.requests.at(-1)!.body).at(-1), JSON.stringify({ result: { path: `app-${calls.length}.png`, imageNotShown: warning } }));
    } finally {
      await server.close();
    }
  });
});

describe("criterion 5 — the counted cost of an image goes into the counters of the task, at each call that carries it", () => {
  const replies = [
    { body: toolCalls(MODEL, [{ id: "s1", name: "app_screenshot", arguments: {} }]) },
    { body: toolCalls(MODEL, [{ id: "n1", name: "noop", arguments: {} }]) },
    { body: answer(MODEL, "Done.") },
  ];
  const noop: ToolDefinition = { name: "noop", description: "Does nothing.", parameters: { type: "object" }, execute: async () => "ok" };

  async function run(limits: TaskLimits): Promise<AgentEvent | undefined> {
    const server = await scriptedServer(replies);
    try {
      const events = await withRuntime(
        { kind: "live", upstream: { baseUrl: server.baseUrl } },
        MODEL,
        (runtime) => exchange(runtime, { instructions: "Explore.", tools: [screenshot(new Map()), noop], limits }, "Go."),
        undefined,
        true,
      );
      return events.at(-1);
    } finally {
      await server.close();
    }
  }

  it("counts 1000 tokens for an image of 1280 × 800 pixels in each of the two calls that carry it", async () => {
    const end = await run(UNBOUNDED);
    assert.deepEqual(end?.type === "end" && [end.counters?.iterations, end.counters?.inputTokens, end.counters?.imageTokens], [3, 3, 2000]);
  });

  it("gives the tokens of the images in the counters of a task a limit stopped", async () => {
    const stopped = await run({ ...UNBOUNDED, maxIterations: 2 });
    assert.deepEqual(stopped?.type === "stopped" && [stopped.reason.limit, stopped.reason.counters.imageTokens], ["iterations", 1000]);
  });

  it("counts on the budget on its own, from the first image", () => {
    const budget = new TaskBudget(UNBOUNDED, new ManualClock());
    budget.countImageTokens(0);
    assert.equal("imageTokens" in budget.counters, false);
    budget.countImageTokens(1000);
    budget.countImageTokens(250);
    assert.equal(budget.counters.imageTokens, 1250);
  });
});

describe("criterion 6 — a recording holds the fingerprint and the size of an image, never the image", () => {
  it("records a session that shows an image without its content, in the recording and in the events", async () => {
    const scenario = SCENARIOS["screenshot-vision.json"]!;
    const server = await scriptedServer(scenario.replies.map((body) => ({ body })));
    try {
      const { recording, events } = await withRuntime(
        { kind: "record", upstream: { baseUrl: server.baseUrl }, origin: { kind: "recorded", model: MODEL, server: "scripted", recordedOn: "2026-01-01" } },
        MODEL,
        async (runtime, gateway) => {
          const events = await exchange(runtime, scenario.session(new ManualClock(), new Map()), scenario.message);
          return { recording: gateway.recording, events };
        },
        undefined,
        true,
      );
      assert.equal(imagesOf(server.requests[1]!.body).length, 1);
      const base64 = SCREENSHOT.toString("base64");
      for (const kept of [JSON.stringify(recording), JSON.stringify(events), readFileSync(new URL("screenshot-vision.json", RECORDINGS), "utf8")]) {
        assert.ok(!kept.includes(base64.slice(0, 64)) && !kept.includes("data:image"));
      }
      assert.match(JSON.stringify(recording), /"sha256":"[0-9a-f]{64}","width":1280,"height":800/);
    } finally {
      await server.close();
    }
  });

  it("refuses a recorded image without its fingerprint or size", () => {
    const recording = JSON.parse(readFileSync(new URL("screenshot-vision.json", RECORDINGS), "utf8")) as {
      exchanges: { request: { messages: { content: unknown }[] } }[];
    };
    const parts = recording.exchanges[1]!.request.messages.at(-1)!.content as Record<string, unknown>[];
    delete parts[1]!["sha256"];
    assert.throws(() => parseRecording(JSON.stringify(recording)), /format version 1: \/exchanges\/1\/request\/messages\/4\/content is invalid/);
  });
});

describe("the images of a request", () => {
  const image = (url: string) => ({ type: "image_url", image_url: { url } });
  const request = (content: unknown) => ({ model: "m", messages: [{ role: "user", content }] });

  it("are kept by their fingerprint and size, and counted", () => {
    const canonical = canonicalRequest(
      request([{ type: "text", text: "Here is a screenshot:" }, image(`data:image/png;base64,${SCREENSHOT.toString("base64")}`)]),
    );
    assert.equal(imageTokensOf(canonical), 1000);
    assert.equal(imageTokensOf(canonicalRequest(request("Hi"))), 0);
    assert.equal(describeRequest(canonical, 2), 'request 2 of the session (1 messages, last message from user: "Here is a screenshot: [image 1280×800]")');
  });

  it("are refused when they are not PNG images in base64, as any other part", () => {
    for (const part of [image("https://example.com/a.png"), image("data:image/jpeg;base64,AAAA"), { type: "input_audio" }]) {
      assert.throws(() => canonicalRequest(request([part])), /The gateway reads texts and PNG images only/);
    }
  });
});
