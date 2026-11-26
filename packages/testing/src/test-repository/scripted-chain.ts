import { answer, toolCalls } from "../scripted-model.ts";
import { MODEL } from "./fixture.ts";

/** A call of a tool, as a scripted completion lists it. */
export const submit = (name: string, args: unknown, id: string) => ({ id, name, arguments: args });

/** The domain the agent that maps the document hands in. */
export const mapped = {
  id: "orders",
  label: "Orders",
  description: "Placing an order.",
  elements: [{ file: "orders.md", role: "How an order is placed." }],
  body: "`orders.md` says how an order is placed.",
};

/** The domain index the agent that consolidates hands in. */
export const index = {
  domains: [{ id: "orders", label: "Orders", description: "Placing and following an order.", from: [{ source: "order-specs", domain: "orders" }] }],
};

/** A test of the orders that passes the checks of the charter, under a title of its own. */
export const spec = (title: string) =>
  `import { test, expect } from "../../../../shared/fixtures.ts";\n\ntest("${title}", async ({ request }) => {\n  await test.step("1. Get the orders", async () => {\n    const response = await request.get("/orders");\n    expect(await response.text()).toContain("A customer places an order");\n    expect("${title}").toBe("${title}");\n  });\n});\n`;

/** The scenarios of the scripted plan. */
export const IDS = ["test-1", "test-2", "test-3"];

/** A scenario of the scripted plan, as the agent that plans proposes it. */
export const scenario = (id: string) => ({
  id,
  title: `The ${id} scenario`,
  intent: `Verifies ${id}.`,
  kind: "functional",
  level: "functional",
  effect: "read",
  case: id === "test-3" ? "negative" : "nominal",
  application: "shop",
  domain: "orders",
  feature: "listing",
  sources: [{ source: "order-specs", item: "Orders" }],
  // The value a scenario enters tells it from the others, which get the same orders.
  data: [{ value: id, from: "made-up" }],
  steps: [{ action: "Get the orders", actions: [], expects: [{ result: "The orders answer", shows: ["A customer places an order"], absent: [] }] }],
});

/** The call that proposes the plan of the three scenarios. */
export const plan = submit("propose_plan", { scenarios: IDS.map(scenario) }, "plan");

/** The answer that ends a session of a design. */
export const ended = { body: answer(MODEL, "Done.") };

/** A read of the orders, which changes nothing. */
export const read = (id = "read") => ({ body: toolCalls(MODEL, [submit("order_specs_read_section", { number: 1 }, id)]) });

/** The replies of the session of a scenario: its test is run, then closed, then the agent answers. */
export const written = (id: string) => [
  { body: toolCalls(MODEL, [submit("run_test", { content: spec(id) }, `r-${id}`)]) },
  { body: toolCalls(MODEL, [submit("propose_test", {}, `p-${id}`)]) },
  ended,
];

/** The reply of the session that plans that submits the plan. */
export const planned = { body: toolCalls(MODEL, [plan]) };

/** The replies of a round of design that finds nothing new: the session that plans submits an empty plan, then answers. */
export const idleRound = (round: number) => [{ body: toolCalls(MODEL, [submit("propose_plan", { scenarios: [] }, `idle-${round}`)]) }, ended];

/** The replies of the rounds that follow a first one which gave tests: three in a row that bring none end the batch. */
export const idleRounds = () => [2, 3, 4].flatMap(idleRound);

/**
 * The replies of the model for the whole chain: the check of the server, the card, the index, then the
 * session that plans — a read of the orders, the plan, an answer — the session of each of three
 * scenarios, then the rounds that bring nothing new.
 */
export const chain = () => [
  { body: { data: [] } },
  // The document is mapped by the agent that reads it: it reads it, hands its domain in with its file, then ends.
  { body: toolCalls(MODEL, [submit("order_specs_read_file", {}, "c0")]) },
  { body: toolCalls(MODEL, [submit("write_domain", mapped, "c1")]) },
  { body: answer(MODEL, "One domain.") },
  { body: toolCalls(MODEL, [submit("submit_index", index, "x1")]) },
  { body: answer(MODEL, "One domain.") },
  read(),
  planned,
  ended,
  ...IDS.flatMap(written),
  ...idleRounds(),
  ...Array.from({ length: 4 }, () => ended),
];

/** The identifier of a run started at noon on the day of the tests, as the clock of {@link later} tells it. */
export const FIRST_RUN = "oqas-2026-11-13T12-00-00-000Z";

/** A clock held at an hour of the day of the tests: that of a run, or of the run that resumes it later. */
export const later = (hour: number) => () => new Date(`2026-11-13T${hour}:00:00.000Z`);

/** The names of the tools the model was offered in a request. */
export const offered = (body: unknown) => (body as { tools: { function: { name: string } }[] }).tools.map((tool) => tool.function.name);
