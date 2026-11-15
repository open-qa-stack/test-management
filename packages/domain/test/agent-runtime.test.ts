import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { AgentRuntimeError, ModelResponseError, ModelUnreachableError, ReplayMissError, SessionClosedError } from "../src/index.ts";

describe("criterion 1 — the AgentRuntime contract depends on nothing", () => {
  it("imports nothing but its own files", () => {
    const root = new URL("../src/", import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    assert.ok(files.length > 0);
    for (const file of files) {
      const imports = [...readFileSync(new URL(file, root), "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!);
      assert.deepEqual(
        imports.filter((i) => !i.startsWith("./") && !i.startsWith("../")),
        [],
        file,
      );
    }
  });
});

describe("runtime errors", () => {
  it("names the address of an unreachable model", () => {
    const error = new ModelUnreachableError("http://localhost:1234/v1");
    assert.ok(error instanceof AgentRuntimeError);
    assert.equal(error.name, "ModelUnreachableError");
    assert.equal(error.url, "http://localhost:1234/v1");
    assert.match(error.message, /http:\/\/localhost:1234\/v1/);
  });

  it("describes the request a recording lacks", () => {
    const error = new ReplayMissError('request 2, last message from user: "hello"');
    assert.equal(error.name, "ReplayMissError");
    assert.match(error.message, /request 2, last message from user: "hello"/);
  });

  it("keeps a plain model response error distinct", () => {
    const error = new ModelResponseError("The model answered with status 500.");
    assert.ok(error instanceof AgentRuntimeError);
    assert.equal(error.name, "ModelResponseError");
    assert.equal(new AgentRuntimeError("x").name, "AgentRuntimeError");
    assert.equal(new SessionClosedError().name, "SessionClosedError");
  });
});
