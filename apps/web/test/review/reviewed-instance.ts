import type { ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";
import type { Api } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";
import { POLICY, PROPOSAL, QUEUE } from "./review-fixture.ts";

/** The API of an instance whose agents wrote the tests of the fixtures for a person to review, beside the configuration and the sessions of a configured instance. */
export class ReviewedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();

  /** The queue of the review. */
  public queue: ReviewQueue = QUEUE;

  /** Whether the queue cannot be read. */
  public unread = false;

  /** What a person reads of each test of the queue, by its identifier. */
  public readonly proposals: ReadonlyMap<string, TestProposal> = new Map([
    [PROPOSAL.id, PROPOSAL],
    [POLICY.id, { ...PROPOSAL, ...POLICY }],
  ]);

  public readonly api: Api = (request) => {
    if (request.path === "/api/reviews")
      return this.unread ? { status: 503, body: JSON.stringify({ code: "unavailable" }) } : { status: 200, body: JSON.stringify(this.queue) };
    const id = /^\/api\/reviews\/([^/]+)$/.exec(request.path)?.[1];
    if (id !== undefined) {
      const proposal = this.proposals.get(id);
      return proposal === undefined ? { status: 404, body: JSON.stringify({ code: "unknown_proposal" }) } : { status: 200, body: JSON.stringify(proposal) };
    }
    return this.configured.api(request);
  };
}
