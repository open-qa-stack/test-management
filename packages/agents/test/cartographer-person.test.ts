import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "vitest";
import { PERSON_SPOKE } from "../src/common/person-message.ts";
import { PersonInbox } from "../src/index.ts";
import { cartography, mappingTheBase, messages, traceOf, workspace } from "./cartographer-support.ts";
import { say } from "./person-support.ts";

const tag = (number: number, text: string) => `<person-message number="${number}">${text}</person-message>`;

interface Asked {
  readonly messages: { readonly role: string; readonly content: string; readonly tool_call_id?: string }[];
}

describe("a person who speaks during a cartography", () => {
  it("is heard by the session that consolidates, in its request then with the result of its tool, never by the session of a source", async () => {
    const path = join(workspace, "inbox-cartography.jsonl");
    say(path, "The orders and the invoices are one domain.");
    const { outcome, server } = await cartography(mappingTheBase(), {
      cards: ["shop-api", "order-specs", "shop"],
      inbox: new PersonInbox(path),
      // The person writes again once the consolidation is asked: its session is open.
      observe: (line) => {
        if (line.phase === "consolidation" && line.event.type === "message") say(path, "Name the domains in English.");
      },
    });
    assert.ok(outcome.index !== undefined, messages(outcome));
    const asked = server.requests.map((request) => request.body as Asked);
    const opened = asked.filter((body) => body.messages.length === 2);
    const orchestrates = (body: Asked) => body.messages[0]!.content.startsWith("You orchestrate the cartography");
    const ofTheSource = opened.filter((body) => !orchestrates(body));
    assert.ok(ofTheSource.length > 0);
    assert.doesNotMatch(JSON.stringify(ofTheSource), /person-message|Messages of the person/);
    const consolidation = opened.find(orchestrates);
    assert.match(consolidation!.messages[0]!.content, /Messages of the person\./);
    assert.ok(consolidation!.messages[1]!.content.endsWith(`\n\n${PERSON_SPOKE}\n${tag(1, "The orders and the invoices are one domain.")}`));
    const submitted = asked.flatMap((body) => body.messages).find((message) => message.role === "tool" && message.tool_call_id === "x1")!;
    assert.equal((JSON.parse(submitted.content) as { result: { person: string } }).result.person, tag(2, "Name the domains in English."));
    assert.deepEqual(
      traceOf(outcome).flatMap((line) => (line.event.type === "person" ? [[line.phase, line.source, line.event.message]] : [])),
      [
        ["consolidation", undefined, 1],
        ["consolidation", undefined, 2],
      ],
    );
  });
});
