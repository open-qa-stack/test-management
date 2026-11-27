import type { ReviewDecision, ReviewQueue, TestProposal } from "@open-qa-stack/domain/sessions";
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
  public readonly proposals = new Map<string, TestProposal>([
    [PROPOSAL.id, PROPOSAL],
    [POLICY.id, { ...PROPOSAL, ...POLICY }],
  ]);

  /** The decisions the console sent, in order, each with the test it is of. */
  public readonly decisions: { readonly id: string; readonly decision: ReviewDecision }[] = [];

  /** Whether the working branch takes a test validated by a commit, or had it already. */
  public committed = true;

  /** The code the instance refuses the next decision with, once; none to take it. */
  public refusal: string | undefined;

  /** Answers a decision: refused once when the test asks it; otherwise kept, the test leaving the view it was in. */
  #decided(id: string, body: string): { status: number; body: string } {
    const refusal = this.refusal;
    this.refusal = undefined;
    if (refusal !== undefined) return { status: 409, body: JSON.stringify({ code: refusal, detail: "No." }) };
    const decision = JSON.parse(body) as ReviewDecision;
    this.decisions.push({ id, decision });
    const tests = this.queue.tests.flatMap((test) =>
      test.id !== id ? [test] : decision.status === "validated" ? [] : [{ ...test, status: "set_aside" as const }],
    );
    this.queue = {
      tests,
      counts: { inReview: tests.filter(({ status }) => status === "in_review").length, setAside: tests.filter(({ status }) => status === "set_aside").length },
    };
    const kept = { id, at: "2026-11-27T10:00:00.000Z", ...decision };
    return {
      status: 200,
      body: JSON.stringify(decision.status === "validated" ? { decision: kept, entered: { branch: "main", committed: this.committed } } : { decision: kept }),
    };
  }

  public readonly api: Api = (request) => {
    const decided = /^\/api\/reviews\/([^/]+)\/decision$/.exec(request.path)?.[1];
    if (decided !== undefined && request.method === "PUT") return this.#decided(decided, request.body!);
    if (request.path === "/api/reviews")
      return this.unread ? { status: 503, body: JSON.stringify({ code: "unavailable" }) } : { status: 200, body: JSON.stringify(this.queue) };
    const id = /^\/api\/reviews\/([^/]+)$/.exec(request.path)?.[1];
    if (id !== undefined) {
      const proposal = this.proposals.get(id);
      if (proposal === undefined) return { status: 404, body: JSON.stringify({ code: "unknown_proposal" }) };
      // A test set aside says why, as the instance kept it.
      const decision = this.decisions.findLast((decided) => decided.id === id)?.decision;
      const told =
        decision?.status === "set_aside" ? { ...proposal, status: "set_aside", decision: { id, at: "2026-11-27T10:00:00.000Z", ...decision } } : proposal;
      return { status: 200, body: JSON.stringify(told) };
    }
    return this.configured.api(request);
  };
}
