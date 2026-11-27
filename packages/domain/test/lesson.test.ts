import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { lessonDraftOf, lessonsFor, lessonsRule, MAX_LESSON, memoryChangeOf, type Lesson } from "../src/index.ts";

const lesson = (id: string, more: Partial<Lesson> = {}): Lesson => ({
  id,
  kind: "instruction",
  text: `Rule ${id}.`,
  target: "design",
  active: true,
  at: "2026-11-27T10:00:00.000Z",
  ...more,
});

describe("a lesson, as a client sends it", () => {
  it("is a text, an application or none, a target, and active unless said otherwise, its texts trimmed", () => {
    assert.deepEqual(lessonDraftOf({ text: " Create customers by the API. ", target: "design" }), {
      text: "Create customers by the API.",
      target: "design",
      active: true,
    });
    assert.deepEqual(lessonDraftOf({ text: "x", application: " shop ", target: "all", active: false }), {
      text: "x",
      application: "shop",
      target: "all",
      active: false,
    });
    assert.deepEqual(lessonDraftOf({ text: "x", application: " ", target: "discovery" }), { text: "x", target: "discovery", active: true });
  });

  it("is refused with why: no lesson, a text empty or too long, a target not known, an activity that is no boolean", () => {
    assert.equal(lessonDraftOf("x"), 'A lesson is { "text", "application"?, "target", "active"? }.');
    const text = `The text of a lesson is 1 to ${MAX_LESSON} characters: a rule the agents read as it is.`;
    assert.equal(lessonDraftOf({ text: " ", target: "design" }), text);
    assert.equal(lessonDraftOf({ text: "x".repeat(MAX_LESSON + 1), target: "design" }), text);
    assert.equal(lessonDraftOf({ text: "x", target: "diagnosis" }), "The target of a lesson is one of design, discovery, all.");
    assert.equal(lessonDraftOf({ text: "x", target: "all", active: "yes" }), "Whether a lesson is active is true or false.");
  });
});

describe("the lessons an agent is given before a task", () => {
  it("are those active, for its work or for all, of the project or of the application of the task, all applications for a task of none", () => {
    const lessons = [
      lesson("project"),
      lesson("shop", { application: "shop" }),
      lesson("crm", { application: "crm" }),
      lesson("all", { target: "all" }),
      lesson("discovery", { target: "discovery" }),
      lesson("off", { active: false }),
    ];
    const ids = (given: Lesson[]) => given.map(({ id }) => id);
    assert.deepEqual(ids(lessonsFor(lessons, "design", "shop")), ["project", "shop", "all"]);
    assert.deepEqual(ids(lessonsFor(lessons, "design")), ["project", "shop", "crm", "all"]);
    assert.deepEqual(ids(lessonsFor(lessons, "discovery", "crm")), ["all", "discovery"]);
  });

  it("are said in the instructions, each on a line with its application, and nothing is said without one", () => {
    assert.equal(lessonsRule([]), "");
    assert.equal(
      lessonsRule([lesson("a"), lesson("b", { application: "shop" })]),
      "The people of the project gave these instructions, which you follow as they are, whatever else you are told:\n- Rule a.\n- For the application shop: Rule b.",
    );
  });
});

describe("a change of the memory, as a client sends it", () => {
  it("replaces what it gives, its texts trimmed; null keeps a lesson to the whole project", () => {
    assert.deepEqual(memoryChangeOf({ text: " Again. ", application: null, target: "all", active: false }), {
      text: "Again.",
      application: null,
      target: "all",
      active: false,
    });
    assert.deepEqual(memoryChangeOf({ application: " shop " }), { application: "shop" });
  });

  it("is refused with why: nothing to change, a text, an application, a target or an activity not valid", () => {
    const none = 'A change of the memory is { "text"?, "application"?, "target"?, "active"? }, one of them at least.';
    for (const body of [null, {}, { other: 1 }]) assert.equal(memoryChangeOf(body), none);
    assert.equal(memoryChangeOf({ text: 3 }), `The text of a lesson is 1 to ${MAX_LESSON} characters: a rule the agents read as it is.`);
    assert.equal(
      memoryChangeOf({ text: "x".repeat(MAX_LESSON + 1) }),
      `The text of a lesson is 1 to ${MAX_LESSON} characters: a rule the agents read as it is.`,
    );
    assert.equal(memoryChangeOf({ application: 3 }), "The application of a lesson is the identifier of one, or null for the whole project.");
    assert.equal(memoryChangeOf({ application: " " }), "The application of a lesson is the identifier of one, or null for the whole project.");
    assert.equal(memoryChangeOf({ target: "x" }), "The target of a lesson is one of design, discovery, all.");
    assert.equal(memoryChangeOf({ active: 1 }), "Whether a lesson is active is true or false.");
  });
});
