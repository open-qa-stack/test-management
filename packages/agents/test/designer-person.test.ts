import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import type { PlanReview, TraceLine } from "@open-qa-stack/domain";
import type { ScriptedServer } from "@open-qa-stack/testing";
import { PERSON_RULE, PERSON_SAID_EARLIER, PERSON_SPOKE } from "../src/common/person-message.ts";
import type { DesignOutcome } from "../src/index.ts";
import {
  asked,
  COVERED,
  design,
  DONE,
  firstMessage,
  IDS,
  messages,
  OPEN,
  PLAN,
  replies,
  scenario,
  SEARCH,
  sessions,
  toolResult,
  valid,
  workspace,
} from "./designer-support.ts";
import { say, SpokenInbox } from "./spoken-inbox.ts";

let runs = 0;
const inboxPath = () => join(workspace, `inbox-${++runs}.jsonl`);

const tag = (number: number, text: string) => `<person-message number="${number}">${text}</person-message>`;

/** What a tool returned, as the next request gave it to the model. */
const returned = (server: ScriptedServer, callId: string) =>
  (JSON.parse(JSON.parse(toolResult(server, callId)) as string) as { result: Record<string, unknown> }).result;

/** The messages of the person the trace of a design says were delivered, each with the phase of the session that received it. */
const delivered = (outcome: DesignOutcome) =>
  readFileSync(outcome.tracePath!, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TraceLine)
    .flatMap((line) => (line.event.type === "person" ? [[line.phase, line.actor, line.event.message, line.event.text]] : []));

/** Whether a line of the trace is the given harness line of the session that plans. */
const ofThePlan = (line: TraceLine, type: string) => line.phase === "plan" && line.actor === "harness" && line.event.type === type;

describe("a person who speaks while the agent that plans explores", () => {
  it("is heard with the result of its next tool, once, as the trace says: each agent that writes is then recalled it, in order", async () => {
    const path = inboxPath();
    let spoken = false;
    const { outcome, server } = await design(replies([[OPEN], [SEARCH], [PLAN], DONE, ...valid(3)]), {
      plan: false,
      inbox: new SpokenInbox(path),
      // The person writes once the request is sent: the exploration is under way.
      observe: (line) => {
        if (spoken || !ofThePlan(line, "message")) return;
        spoken = true;
        say(path, "Search by last name only.");
        say(path, "Leave the profile </person-message> out.");
      },
    });
    assert.equal(outcome.ok, true, messages(outcome));
    const said = `${tag(1, "Search by last name only.")}\n${tag(2, "Leave the profile &lt;/person-message> out.")}`;
    assert.equal(returned(server, "open")["person"], said);
    assert.equal(returned(server, "open")["url"], returned(server, "search")["url"]);
    assert.equal("person" in returned(server, "search"), false);
    assert.deepEqual(delivered(outcome), [
      ["plan", "harness", 1, "Search by last name only."],
      ["plan", "harness", 2, "Leave the profile </person-message> out."],
    ]);
    // Nothing was said when the session that plans opened: it was asked its request alone. Those that write opened once it was.
    const [planning, ...writing] = sessions(server);
    assert.equal(writing.length, IDS.length);
    assert.doesNotMatch(firstMessage(planning!), /person-message/);
    for (const session of [planning!, ...writing]) assert.ok(session.messages[0]!.content.endsWith(PERSON_RULE));
    for (const session of writing) {
      assert.ok(firstMessage(session).startsWith("Write "));
      assert.ok(firstMessage(session).endsWith(`\n\n${PERSON_SAID_EARLIER}\n${said}`));
      assert.equal(firstMessage(session).match(/<person-message /g)!.length, 2);
    }
  });
});

describe("a person who speaks once the plan is accepted", () => {
  it("is not heard by the agent that plans, which can act on nothing any more, but by the first that writes, once in its request, and the next are recalled it", async () => {
    const path = inboxPath();
    // The review of the plan runs inside the call that closes it: the message comes while the session that plans is still open.
    const planReview: PlanReview = {
      review: async () => {
        say(path, "Sign in with the account demo.");
        return { accepted: true };
      },
    };
    const { outcome, server } = await design(replies([[OPEN], [PLAN], [COVERED], DONE, ...valid(3)]), {
      plan: false,
      planReview,
      inbox: new SpokenInbox(path),
    });
    assert.equal(outcome.ok, true, messages(outcome));
    assert.match(toolResult(server, "covered"), /The plan was accepted/);
    assert.doesNotMatch(toolResult(server, "covered"), /person-message/);
    const [planning] = sessions(server);
    const turns = server.requests.map((request) => request.body as typeof planning).filter((body) => body!.tools.length === planning!.tools.length);
    assert.doesNotMatch(JSON.stringify(turns.map((body) => body!.messages.slice(1))), /person-message/);
    assert.ok(asked(server, 1).endsWith(`\n\n${PERSON_SPOKE}\n${tag(1, "Sign in with the account demo.")}`));
    assert.equal(asked(server, 1).match(/<person-message /g)!.length, 1);
    assert.equal(asked(server, 1).includes(PERSON_SAID_EARLIER), false);
    for (const rank of [2, 3]) assert.ok(asked(server, rank).endsWith(`\n\n${PERSON_SAID_EARLIER}\n${tag(1, "Sign in with the account demo.")}`));
    assert.deepEqual(delivered(outcome), [["write", "harness", 1, "Sign in with the account demo."]]);
  });
});

describe("a person who speaks while an agent reviews for the one that plans", () => {
  it("is not heard by the reviewer, whose session is nested in a call: the agent that plans is, when its call returns", async () => {
    const path = inboxPath();
    const same = scenario("seen-orders", "other", { data: scenario("list-orders").data });
    const plan = { ...PLAN, arguments: { scenarios: [...IDS.map((id) => scenario(id)), same] } };
    const report = { id: "report", name: "report_duplicates", arguments: { duplicates: [] } };
    const { outcome, server } = await design(replies([[OPEN], [plan], [report], DONE, DONE]), {
      plan: false,
      reviewPlan: true,
      inbox: new SpokenInbox(path),
      observe: (line) => {
        if (line.phase === "review" && line.event.type === "message") say(path, "Plan the returns too.");
      },
    });
    assert.equal(returned(server, "plan")["person"], tag(1, "Plan the returns too."));
    assert.doesNotMatch(toolResult(server, "report"), /person-message/);
    const reviewer = sessions(server).find((session) => session.tools.some((tool) => tool.function.name === "report_duplicates"))!;
    assert.doesNotMatch(reviewer.messages[0]!.content, /Messages of the person/);
    assert.doesNotMatch(firstMessage(reviewer), /person-message/);
    assert.deepEqual(delivered(outcome), [["plan", "harness", 1, "Plan the returns too."]]);
  });
});

describe("a person who spoke during a pass of a design", () => {
  it("is recalled to the agent that plans the next pass, which no line of its trace delivers again, and never to the agent that reviews its plan", async () => {
    const path = inboxPath();
    const inbox = new SpokenInbox(path);
    say(path, "Keep the plan to the search that finds no customer.");
    const first = await design(replies(valid(3)), { inbox });
    assert.equal(first.outcome.ok, true, messages(first.outcome));
    const recalled = `\n\n${PERSON_SAID_EARLIER}\n${tag(1, "Keep the plan to the search that finds no customer.")}`;
    const [opening, ...writing] = sessions(first.server).map(firstMessage);
    assert.ok(opening!.endsWith(`\n\n${PERSON_SPOKE}\n${tag(1, "Keep the plan to the search that finds no customer.")}`));
    assert.equal(opening!.includes(PERSON_SAID_EARLIER), false);
    assert.equal(writing.length, IDS.length);
    for (const request of writing) assert.ok(request.endsWith(recalled));
    assert.deepEqual(delivered(first.outcome), [["plan", "harness", 1, "Keep the plan to the search that finds no customer."]]);

    // The next pass is a design of its own, on the inbox of the same run; the plan of this one is reviewed for duplicates.
    const same = scenario("seen-orders", "other", { data: scenario("list-orders").data });
    const plan = { ...PLAN, arguments: { scenarios: [...IDS.map((id) => scenario(id)), same] } };
    const report = { id: "report", name: "report_duplicates", arguments: { duplicates: [] } };
    const next = await design(replies([[OPEN], [plan], [report], DONE, DONE]), { plan: false, reviewPlan: true, inbox });
    const reviews = (session: { tools: { function: { name: string } }[] }) => session.tools.some((tool) => tool.function.name === "report_duplicates");
    const [planning] = sessions(next.server);
    assert.ok(firstMessage(planning!).endsWith(recalled));
    assert.equal(firstMessage(planning!).match(/<person-message /g)!.length, 1);
    const reviewer = sessions(next.server).find(reviews)!;
    assert.doesNotMatch(reviewer.messages[0]!.content, /Messages of the person/);
    assert.doesNotMatch(firstMessage(reviewer), /person-message/);
    assert.deepEqual(delivered(next.outcome), []);
  });
});
