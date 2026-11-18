import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { languageRule, testLanguageRule } from "../src/common/language-rules.ts";
import { close, design, DONE, IDS, messages, replies, run, sessions, spec, type Call, valid } from "./designer-support.ts";

/** The instructions each session of a design was opened with, in order. */
const instructionsOf = (server: Parameters<typeof sessions>[0]) => sessions(server).map((session) => session.messages[0]!.content);

describe("the rule of the language of the person", () => {
  it("names the language and its tag, and leaves the instructions and the names as they are", () => {
    assert.match(languageRule("fr"), /^Language of the person\. Write what is meant for the person in French \(fr\): .*uncovered.*findings and remarks/);
    assert.match(languageRule("en"), /in English \(en\)/);
    assert.match(
      languageRule("fr"),
      /These instructions, the messages of the harness, the names of the tools and of their fields, and the identifiers stay as they are\.$/,
    );
  });
});

describe("the rule of the language of the tests", () => {
  it("names the language and its tag, keeps the code in English and the texts of the application as it shows them", () => {
    assert.match(
      testLanguageRule("fr"),
      /^Language of the tests\. Write what the tests say in French \(fr\): the titles of the scenarios and of the tests, their steps/,
    );
    assert.match(testLanguageRule("en"), /in English \(en\)/);
    assert.match(
      testLanguageRule("fr"),
      /The code itself, its names included, stays in English, and a text the application shows is quoted as it shows it, never translated\.$/,
    );
  });
});

describe("a design whose tests are written in French", () => {
  it("tells the agent that plans and each agent that writes, at the end of their instructions", async () => {
    const { outcome, server } = await design(replies(valid(3)), { testLanguage: "fr" });
    assert.equal(outcome.ok, true, messages(outcome));
    const instructions = instructionsOf(server);
    assert.equal(instructions.length, 1 + IDS.length);
    for (const text of instructions) assert.ok(text.endsWith(`\n\n${testLanguageRule("fr")}`), text.slice(-200));
  });

  it("tells it the agents that review no test", async () => {
    const report = (id: string): Call => ({ id, name: "report_findings", arguments: { findings: [] } });
    const reviewed = (name: string) => [[run(spec(name), `r-${name}`)], [close(`c-${name}`)], [report(`f-${name}`)], DONE, DONE];
    const { outcome, server } = await design(replies(["list-orders", "place-order", "follow-order"].flatMap(reviewed)), {
      reviewTests: true,
      testLanguage: "fr",
    });
    assert.equal(outcome.ok, true, messages(outcome));
    const instructions = instructionsOf(server);
    const told = instructions.filter((text) => text.includes(testLanguageRule("fr")));
    assert.equal(told.length, 1 + IDS.length);
    assert.equal(instructions.length - told.length, IDS.length);
  });
});

describe("a design whose configuration names no language of the tests", () => {
  it("tells the agents that plan and write to write them in English", async () => {
    const { server } = await design(replies(valid(3)));
    for (const text of instructionsOf(server)) assert.ok(text.endsWith(testLanguageRule("en")));
  });
});
