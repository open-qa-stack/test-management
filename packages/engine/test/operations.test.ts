import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { operationIds } from "@open-qa-stack/domain";
import {
  Campaigns,
  Configuration,
  ENGINE_OPERATIONS,
  Executions,
  HOST_METHODS,
  KnowledgeDocuments,
  KnowledgeDomains,
  KnowledgeMapping,
  KnowledgeSources,
  ModelConnection,
  EnvironmentAddresses,
  PastRuns,
  RepositorySetup,
  RepositoryTests,
  Secrets,
  Sessions,
  TestReadings,
  TestSources,
  type EngineClasses,
} from "../src/index.ts";
import * as engine from "../src/index.ts";

/** Each class of the engine whose methods a client or a host calls, by name. */
const CLASSES: { readonly [C in keyof EngineClasses]: { readonly prototype: object } } = {
  Sessions,
  Configuration,
  ModelConnection,
  EnvironmentAddresses,
  Secrets,
  RepositorySetup,
  KnowledgeDocuments,
  KnowledgeDomains,
  KnowledgeMapping,
  KnowledgeSources,
  RepositoryTests,
  TestReadings,
  TestSources,
  Executions,
  PastRuns,
  Campaigns,
};

/**
 * The classes the engine exports that hold no operation, with why: a host builds them, or catches them, and no person
 * asks anything of them.
 */
const NOT_OPERATIONS: Readonly<Record<string, string>> = {
  Run: "the operations on sessions run it; a host of a run alone builds one",
  FileSecretStore: "the store of the values Secrets is given",
  NoRepositoryError: "an error an operation raises",
};

/** The public methods of a class, as its prototype holds them. */
function methodsOf(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor" && typeof Object.getOwnPropertyDescriptor(prototype, name)!.value === "function")
    .sort();
}

describe("the operations of the engine", () => {
  it("name every public method of its classes, as an operation a person asks for or as one a host calls", () => {
    for (const [name, { prototype }] of Object.entries(CLASSES)) {
      const listed = [
        ...((ENGINE_OPERATIONS as Record<string, readonly string[]>)[name] ?? []),
        ...((HOST_METHODS as Record<string, readonly string[]>)[name] ?? []),
      ];
      assert.deepEqual(methodsOf(prototype), [...listed].sort(), `${name}: an operation, or a method of a host, is missing or named twice`);
    }
  });

  it("leave out no class the engine exports, but those that hold none", () => {
    const classes = Object.entries(engine)
      .filter(([, value]) => typeof value === "function" && Function.prototype.toString.call(value).startsWith("class "))
      .map(([name]) => name)
      .sort();
    assert.deepEqual(classes, [...Object.keys(CLASSES), ...Object.keys(NOT_OPERATIONS)].sort());
  });

  it("are named Class.method, each once", () => {
    const ids = operationIds();
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids[0], "Sessions.project");
    assert.ok(ids.includes("Secrets.save"));
    assert.ok(!ids.includes("Sessions.start" as never));
  });
});
