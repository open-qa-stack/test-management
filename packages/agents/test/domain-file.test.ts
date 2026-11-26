import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { knowledgeLanguageRule } from "../src/common/language-rules.ts";
import { AgentRuntimeError, type AgentEvent, type AgentRuntime, type SourceManifest } from "@open-qa-stack/domain";
import type { ExportedElement } from "@open-qa-stack/tools";
import { MAX_REMINDERS } from "../src/common/agent-task.ts";
import { Journal } from "../src/common/journal.ts";
import { minimalBody, renderDomainFile, unfenced } from "../src/source-workflow/domain-file.ts";
import { exportVocabulary } from "../src/source-workflow/cited-names.ts";
import { coverageErrors, domainFileErrors, MAX_DOMAIN_FILE_LENGTH } from "../src/source-workflow/domain-file-control.ts";
import { writeDomain } from "../src/source-workflow/write-domain.ts";
import { domainRequest } from "../src/source-workflow/writing-prompt.ts";

const SECRET = "postgresql://shop:s3cr3t-pw@127.0.0.1:5999/shop";
const ORDERS = { id: "orders", label: "Orders", description: "Orders placed by customers." };
const CUSTOMERS = { id: "customers", label: "Customers", description: "The customers of the shop." };
const LIMITS = { maxIterations: 20, maxDurationMs: null, maxActions: null };
const MEMBERS = [
  { name: "public.orders", kind: "table", role: "One order and its status." },
  { name: "public.order_total(order_id bigint)", kind: "routine", role: "Adds up an order | its lines." },
];
const GOOD = "| Element | Role |\n|---|---|\n| `public.orders` | One order. |\n\nCall `public.order_total(order_id bigint)` for its total.";

const element = (name: string, kind: string, summary: string): ExportedElement => ({
  name,
  kind,
  summary,
  definition: "",
  fingerprint: "sha256:0",
  names: [],
  links: [],
  file: `${kind}s/${name}.sql`,
});
const ELEMENTS = [
  { element: element("public.orders", "table", `table public.orders\n  columns: id bigint not null, note text DEFAULT '${SECRET}'`), role: MEMBERS[0]!.role },
  {
    element: element("public.order_total(order_id bigint)", "routine", "function public.order_total(order_id bigint) returns numeric"),
    role: MEMBERS[1]!.role,
  },
];

describe("the file of a domain", () => {
  it("has a header the harness writes — label, identifier, description — then the body", () => {
    assert.equal(renderDomainFile(ORDERS, GOOD), `# Orders (\`orders\`)\n\nOrders placed by customers.\n\n${GOOD}`);
    // A model often repeats the title, and the description after it: the header already gives them.
    const header = "# Orders (`orders`)\n\nOrders placed by customers.\n\n";
    assert.equal(renderDomainFile(ORDERS, `# Orders\n\nOrders placed by customers.\n\n${GOOD}`), `${header}${GOOD}`);
    assert.equal(renderDomainFile(ORDERS, `# The orders\n\n${GOOD}`), `${header}${GOOD}`);
  });

  it("is read without the code fence a model puts around its whole answer, and only that one", () => {
    assert.equal(unfenced("```markdown\nA table.\n\n```sql\nSELECT 1;\n```\n```"), "A table.\n\n```sql\nSELECT 1;\n```");
    assert.equal(unfenced("  ```\nA table.```\n"), "A table.");
    assert.equal(unfenced("\nA table, then:\n```sql\nSELECT 1;\n```\n"), "A table, then:\n```sql\nSELECT 1;\n```");
  });

  it("is, when the harness writes it, a table of the elements with their kind and role", () => {
    assert.equal(
      minimalBody(MEMBERS),
      [
        "| Element | Kind | Role |",
        "|---|---|---|",
        "| `public.orders` | table | One order and its status. |",
        "| `public.order_total(order_id bigint)` | routine | Adds up an order \\| its lines. |",
      ].join("\n"),
    );
    assert.deepEqual(domainFileErrors(minimalBody(MEMBERS), MEMBERS, [SECRET]), []);
  });
});

describe("the control of the body of a domain file", () => {
  it("keeps a body that names every element of the domain between backticks", () => {
    assert.deepEqual(domainFileErrors(GOOD, MEMBERS, [SECRET]), []);
  });

  it("refuses an empty body, a body too long, and one that holds a secret, without repeating the secret", () => {
    assert.deepEqual(domainFileErrors("", MEMBERS, []), ["The answer is empty. Write the markdown body of the file."]);
    const long = `${GOOD}\n${"x".repeat(MAX_DOMAIN_FILE_LENGTH)}`;
    assert.deepEqual(domainFileErrors(long, MEMBERS, []), [
      `The body has ${long.length} characters. Keep it under ${MAX_DOMAIN_FILE_LENGTH}: one line per element, and shorter hints.`,
    ]);
    assert.deepEqual(domainFileErrors(`${GOOD}\nConnect with ${encodeURIComponent(SECRET)}.`, MEMBERS, [SECRET]), [
      "The body holds a secret of the configuration. Write it without the secret.",
    ]);
  });

  it("refuses a body that leaves an element unnamed, and proposes the backticks around one it names without them", () => {
    assert.deepEqual(domainFileErrors("The table public.orders holds the orders.", MEMBERS, []), [
      "public.orders is named, but not between backticks. Proposed: `public.orders`, where you name it.",
      "These elements of the domain are not named: public.order_total(order_id bigint). Name each exactly as written, between backticks, such as `public.order_total(order_id bigint)`.",
    ]);
  });
});

describe("the last control of a source", () => {
  const manifest = (elements: Partial<SourceManifest["elements"][number]>[]): SourceManifest => ({
    formatVersion: 1,
    source: { id: "shop-db", type: "postgresql" },
    fingerprint: "sha256:1",
    producedAt: "2026-11-13T03:00:00.000Z",
    status: "in_progress",
    domains: [ORDERS],
    elements: elements.map((more, i) => ({ name: `public.t${i}`, kind: "table", fingerprint: "sha256:0", file: `export/tables/public.t${i}.sql`, ...more })),
  });

  it("finds every exported element named in the file of its domain, or set aside with its reason", () => {
    const covered = manifest([{ domain: "orders", role: "A." }, { dismissed: "Technical." }]);
    assert.deepEqual(coverageErrors(covered, new Map([["orders", "`public.t0` holds A."]])), []);
  });

  it("names each element that is in no file: unnamed in the file of its domain, in a domain without file, or left unplaced", () => {
    const lost = manifest([{ domain: "orders", role: "A." }, { domain: "customers", role: "B." }, { unplaced: "The model had 3 calls." }, {}]);
    assert.deepEqual(coverageErrors(lost, new Map([["orders", "public.t0 holds A."]])), [
      "public.t0 is not named in the file of its domain orders.",
      "public.t1 is not named in the file of its domain customers.",
      "public.t2 is in no domain and was not set aside.",
      "public.t3 is in no domain and was not set aside.",
    ]);
  });
});

describe("the request of the file of a domain", () => {
  it("gives the domain, its elements with their role and summary, and the other domains of the source", () => {
    assert.equal(
      domainRequest("shop-db", ORDERS, ELEMENTS, [CUSTOMERS]),
      [
        "Write the file of the domain orders of the source shop-db.",
        "",
        "Orders: Orders placed by customers.",
        "",
        "Its 2 elements, each named by its ### line, with its role:",
        "",
        "### public.orders — One order and its status.",
        "table public.orders",
        `  columns: id bigint not null, note text DEFAULT '${SECRET}'`,
        "",
        "### public.order_total(order_id bigint) — Adds up an order | its lines.",
        "function public.order_total(order_id bigint) returns numeric",
        "",
        "The other domains of the source:",
        "- customers — Customers: The customers of the shop.",
        "",
        "Answer with the markdown body alone.",
      ].join("\n"),
    );
    assert.ok(domainRequest("shop-db", ORDERS, ELEMENTS, []).includes("\n\nThe source has no other domain.\n\n"));
  });
});

/** Writes the file of the orders against a session that answers each message with the next text, or ends as given. */
async function written(answers: readonly (string | AgentEvent)[]) {
  const journal = new Journal();
  const sent: string[] = [];
  let turn = 0;
  const runtime: AgentRuntime = {
    openSession: async (options) => {
      assert.deepEqual(options.tools, []);
      // The file is written in the language of the person.
      assert.ok(options.instructions.endsWith(`\n\n${knowledgeLanguageRule("fr")}`), options.instructions);
      return {
        async *send(): AsyncIterable<AgentEvent> {
          const next = answers[turn++]!;
          if (typeof next !== "string") {
            yield next;
            return;
          }
          yield { type: "text", text: next.slice(0, 5) };
          yield { type: "text", text: next.slice(5) };
          yield { type: "end", counters: { iterations: turn, actions: 0, elapsedMs: 10 } };
        },
        close: async () => undefined,
      };
    },
    close: async () => undefined,
  };
  const outcome = await writeDomain({
    language: "fr",
    sourceId: "shop-db",
    sourceType: "postgresql",
    notes: [],
    domain: ORDERS,
    members: ELEMENTS,
    others: [CUSTOMERS],
    vocabulary: exportVocabulary("shop-db", { elements: ELEMENTS.map(({ element: exported }) => exported), fingerprint: "sha256:0" }),
    runtime,
    limits: LIMITS,
    secrets: [SECRET],
    journal,
    sent: (message) => sent.push(message),
    received: () => undefined,
  });
  return { outcome, sent, journal: journal.entries().map((entry) => entry.message) };
}

describe("the writing of the file of a domain", () => {
  it("keeps the body of the model that passes the control, its fence taken away, after one request without any secret", async () => {
    const { outcome, sent, journal } = await written([`\`\`\`markdown\n${GOOD}\n\`\`\``]);
    assert.deepEqual(outcome, { usage: { requests: 1 }, run: { iterations: 1, actions: 0, durationMs: 10 }, body: GOOD, writtenBy: "model" });
    assert.deepEqual([sent.length, sent[0]!.includes("note text DEFAULT '[secret]'"), sent[0]!.includes("s3cr3t-pw")], [1, true, false]);
    assert.deepEqual(journal, []);
  });

  it("tells the model what the control refused, and keeps the body it answers with next", async () => {
    const { outcome, sent, journal } = await written(["The table public.orders holds the orders.", GOOD]);
    assert.deepEqual([outcome.writtenBy, outcome.body, outcome.usage.requests], ["model", GOOD, 2]);
    assert.equal(
      sent[1],
      [
        "The file was not kept. Fix what follows and answer again with the whole body.",
        "- public.orders is named, but not between backticks. Proposed: `public.orders`, where you name it.",
        "- These elements of the domain are not named: public.order_total(order_id bigint). Name each exactly as written, between backticks, such as `public.order_total(order_id bigint)`.",
      ].join("\n"),
    );
    assert.equal(journal.length, 1);
    assert.match(journal[0]!, /^The file of the domain orders was not kept: public\.orders is named, but not between backticks\./);
  });

  it("refuses a body that cites in its code a name the export of the source does not have, and keeps the next one", async () => {
    const { outcome, sent, journal } = await written([`${GOOD}\n\nJoin \`public.payments\` to it.`, GOOD]);
    assert.deepEqual([outcome.writtenBy, outcome.body, outcome.usage.requests], ["model", GOOD, 2]);
    assert.equal(
      sent[1],
      [
        "The file was not kept. Fix what follows and answer again with the whole body.",
        "- public.payments is not an element of shop-db, and nothing in its export has this name. Remove it, or use a name the request shows.",
      ].join("\n"),
    );
    assert.match(journal[0]!, /^The file of the domain orders was not kept: public\.payments is not an element of shop-db/);
  });

  it("asks once about a name that is only doubtful, and keeps the same body answered again", async () => {
    const doubtful = `${GOOD}\n\nFilter on \`order_status\`.`;
    const { outcome, sent } = await written([doubtful, doubtful]);
    assert.deepEqual([outcome.writtenBy, outcome.body, outcome.usage.requests], ["model", doubtful, 2]);
    assert.equal(
      sent[1],
      [
        "The file is not kept yet. Check what follows, then answer again with the whole body.",
        "- The export of shop-db writes these names nowhere: `order_status`. If they are columns or elements, use the names the request shows. If they are something else, answer again with the same body to confirm.",
      ].join("\n"),
    );
  });

  it("writes a minimal body itself once every reminder was refused, with the reason and the last body of the model", async () => {
    const bad = (i: number) => `Attempt ${i}: nothing named.`;
    const { outcome, sent, journal } = await written(Array.from({ length: MAX_REMINDERS + 1 }, (_, i) => (i === MAX_REMINDERS ? "" : bad(i))));
    assert.equal(sent.length, MAX_REMINDERS + 1);
    assert.deepEqual(
      [outcome.writtenBy, outcome.body, outcome.refused, outcome.refusedBody],
      ["harness", minimalBody(MEMBERS), "The answer is empty. Write the markdown body of the file.", bad(MAX_REMINDERS - 1)],
    );
    assert.equal(journal.at(-1), "The harness wrote the file of the domain orders itself: The answer is empty. Write the markdown body of the file.");
  });

  it("writes the body itself when the session reaches a limit or fails, and never keeps a secret the model wrote", async () => {
    const stopped = await written([{ type: "stopped", reason: { limit: "duration", counters: { iterations: 1, actions: 0, elapsedMs: 5 } } }]);
    assert.deepEqual(
      [stopped.outcome.writtenBy, stopped.outcome.refused, stopped.outcome.stoppedBy],
      ["harness", "The session reached its duration limit.", "duration"],
    );
    assert.equal("refusedBody" in stopped.outcome, false);
    const failed = await written([
      { type: "error", error: new AgentRuntimeError("Cannot reach the model."), counters: { iterations: 0, actions: 0, elapsedMs: 1 } },
    ]);
    assert.deepEqual([failed.outcome.writtenBy, failed.outcome.refused], ["harness", "The session failed: Cannot reach the model."]);
    const leaking = await written([`${GOOD}\nConnect with ${SECRET}.`, GOOD]);
    assert.deepEqual(
      [leaking.outcome.writtenBy, leaking.sent[1]!.includes("s3cr3t-pw"), leaking.journal.join("\n").includes("s3cr3t-pw")],
      ["model", false, false],
    );
  });
});
