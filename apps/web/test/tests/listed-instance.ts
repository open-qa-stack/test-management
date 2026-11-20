import { campaignCounts } from "@open-qa-stack/domain/sessions";
import type {
  Campaign,
  CampaignProgress,
  Execution,
  LaunchState,
  RepositoryTest,
  TestExecution,
  TestReading,
  TestVersion,
} from "@open-qa-stack/domain/sessions";
import type { Api } from "../built-console.ts";
import { ConfiguredInstance } from "../configuration/configured-instance.ts";
import { PROGRESS } from "../campaigns/campaigns-fixture.ts";
import { EXECUTIONS } from "../executions/executions-fixture.ts";
import { READING, TESTS } from "./tests-fixture.ts";

/** A capture, as the instance serves one: what it shows does not matter to the screen. */
const PIXEL = "";

/** The API of an instance whose test repository holds the tests and the executions of the fixtures, beside the configuration and the sessions of a configured instance. */
export class ListedInstance {
  /** The configuration and the sessions of the instance. */
  public readonly configured = new ConfiguredInstance();
  /** The tests of its repository. */
  public tests: readonly RepositoryTest[] = TESTS;

  /** The executions of its tests, the latest first. */
  public executions: readonly Execution[] = EXECUTIONS;

  /** The execution a page of them ends with, when one comes after it. */
  public next: string | undefined = "older";

  /** The versions of the tests of a file, the latest first. */
  public versions: readonly TestVersion[] = [];

  /** The test of the policies read in steps, from the run of an execution, which kept a trace of it. */
  public reading: TestReading = { ...READING, ranAt: "2026-11-19T10:00:05.000Z", traced: true };

  /** The campaigns of the instance, each with what came of its tests, the latest planned first. */
  public campaigns: CampaignProgress[] = [PROGRESS];

  /** The launch of tests that runs, and the last one that ended. */
  public launches: LaunchState = {};

  /** The code the instance refuses the next change of a campaign with, once; none to take it. */
  public refusal: string | undefined;

  /** Whether the configuration cannot be read. */
  public unconfigured = false;

  /** Answers a change of a campaign: refused once when the test asks it, otherwise the campaign as the change leaves it. */
  #change(id: string, change: (campaign: Campaign) => Campaign): { status: number; body: string } {
    const refusal = this.refusal;
    this.refusal = undefined;
    if (refusal !== undefined) return { status: 409, body: JSON.stringify({ code: refusal, detail: "No." }) };
    const index = this.campaigns.findIndex(({ campaign }) => campaign.id === id);
    const campaign = change(this.campaigns[index]!.campaign);
    this.campaigns[index] = { ...this.campaigns[index]!, campaign };
    return { status: 200, body: JSON.stringify(campaign) };
  }

  /** What the API answers of the campaigns and the launches; `undefined` for any other path. */
  #campaignsApi(path: string, method: string, body: string | undefined): { status: number; body: string } | undefined {
    if (path === "/api/launches" && method === "POST") {
      const refusal = this.refusal;
      this.refusal = undefined;
      if (refusal !== undefined) return { status: 409, body: JSON.stringify({ code: refusal, detail: "No." }) };
      const request = JSON.parse(body!) as { paths: string[]; environment?: string };
      this.launches = { running: { startedAt: "2026-11-20T10:01:00.000Z", environment: request.environment ?? "local", paths: request.paths } };
      return { status: 202, body: JSON.stringify(this.launches.running) };
    }
    if (path === "/api/launches") return { status: 200, body: JSON.stringify(this.launches) };
    if (path === "/api/campaigns" && method === "POST") {
      const refusal = this.refusal;
      this.refusal = undefined;
      if (refusal !== undefined) return { status: 400, body: JSON.stringify({ code: refusal, detail: "No." }) };
      const plan = JSON.parse(body!) as { name: string; environment: string; tags: string[] };
      const campaign: Campaign = {
        id: `c${this.campaigns.length + 1}`,
        name: plan.name,
        environment: plan.environment,
        scope: { tags: plan.tags },
        status: "planned",
        createdAt: "2026-11-20T10:00:00.000Z",
        tests: [],
      };
      this.campaigns.unshift({ campaign, results: PROGRESS.results.map(({ path, title }) => ({ path, title, verdict: "not_run" })) });
      return { status: 201, body: JSON.stringify(campaign) };
    }
    if (path === "/api/campaigns")
      return {
        status: 200,
        body: JSON.stringify({ items: this.campaigns.map(({ campaign, results }) => ({ ...campaign, counts: campaignCounts(results) })) }),
      };
    const [, id, gesture] = /^\/api\/campaigns\/([^/]+)(?:\/(\w+))?$/.exec(path) ?? [];
    if (id === undefined) return undefined;
    const found = this.campaigns.find(({ campaign }) => campaign.id === id);
    if (found === undefined) return { status: 404, body: JSON.stringify({ code: "unknown_campaign" }) };
    if (gesture === "readiness")
      return this.#change(id, (campaign) => ({ ...campaign, status: "ready", tests: found.results.map(({ path, title }) => ({ path, title })) }));
    if (gesture === "launches") {
      const answer = this.#change(id, (campaign) => ({ ...campaign, status: "in_progress" }));
      const paths = found.results.map(({ path }) => path);
      // The launch that runs has finished its first test.
      const progress = { total: paths.length, finished: [{ path: paths[0]!, title: found.results[0]!.title, verdict: "passed" as const }] };
      if (answer.status === 200)
        this.launches = { running: { startedAt: "2026-11-20T10:01:00.000Z", environment: found.campaign.environment, paths, campaign: id, progress } };
      return answer.status === 200 ? { status: 202, body: JSON.stringify(this.launches.running) } : answer;
    }
    if (gesture === "closure") return this.#change(id, (campaign) => ({ ...campaign, status: "closed", closedAt: "2026-11-20T11:00:00.000Z" }));
    return { status: 200, body: JSON.stringify(found) };
  }

  /** What came of the tests of a file in each execution, the latest first: its results in the executions. */
  #ofFile(): readonly TestExecution[] {
    return this.executions.flatMap(({ report: _report, results, ...head }) => results.map((result) => ({ ...head, result })));
  }

  /** What the API answers. */
  public readonly api: Api = (request) => {
    const campaigns = this.#campaignsApi(request.path, request.method, request.body);
    if (campaigns !== undefined) return campaigns;
    if (request.path === "/api/configuration" && this.unconfigured) return { status: 503, body: JSON.stringify({ code: "unavailable" }) };
    if (request.path === "/api/tests") return { status: 200, body: JSON.stringify({ items: this.tests }) };
    if (request.path === "/api/tests/reading") return { status: 200, body: JSON.stringify(this.reading) };
    if (request.path === "/api/executions")
      return {
        status: 200,
        body: JSON.stringify({ items: this.executions, total: this.executions.length, start: 0, ...(this.next === undefined ? {} : { next: this.next }) }),
      };
    if (request.path.startsWith("/api/executions/")) {
      const execution = this.executions.find(({ id }) => request.path === `/api/executions/${id}`);
      return execution === undefined ? { status: 404, body: JSON.stringify({ code: "unknown_execution" }) } : { status: 200, body: JSON.stringify(execution) };
    }
    if (request.path === "/api/tests/executions") return { status: 200, body: JSON.stringify({ items: this.#ofFile() }) };
    if (request.path === "/api/tests/versions") return { status: 200, body: JSON.stringify({ items: this.versions }) };
    if (request.path === "/api/tests/capture") return { status: 200, contentType: "image/png", body: PIXEL };
    return this.configured.api(request);
  };
}
