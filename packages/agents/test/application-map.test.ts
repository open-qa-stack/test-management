import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ToolDefinition } from "@open-qa-stack/domain";
import { ApplicationMap } from "../src/application-explorer/application-map.ts";
import { applicationExplorerInstructions, explorationRequest } from "../src/application-explorer/application-explorer-prompt.ts";
import { screenRoute, ScreenTrail, type ExplorationMode } from "../src/application-explorer/screen-trail.ts";
import { Journal } from "../src/common/journal.ts";

const BASE = "http://shop.test";
const PAGES: Readonly<Record<string, { title: string; page: string }>> = {
  "/": {
    title: "Shop",
    page: '- heading "Shop"\n- link "Customers":\n  - /url: /customers\n- link "Log out":\n  - /url: "/logout"\n- link "Docs":\n  - /url: https://elsewhere.test/docs',
  },
  "/customers": {
    title: "Customers",
    page: '- heading "Customers"\n- textbox "Search"\n- link "Ada":\n  - /url: /customers/ab12cd34\n- link "Home":\n  - /url: /\n- text: 2 customers',
  },
  "/customers/ab12cd34": { title: "Ada", page: '- heading "Ada Lovelace"\n- text: No orders yet' },
};

type Told = string | { error: string };

/** A shop of three screens, the tools that browse it, and the map of what an agent makes of it. */
function explored(mode: ExplorationMode = "read-only") {
  let at = "/";
  const clicked: unknown[] = [];
  const state = (extra: object = {}) => ({ url: `${BASE}${at}`, title: PAGES[at]?.title ?? "Elsewhere", ...extra });
  const tool = (action: string, execute: (args: Record<string, unknown>) => unknown): ToolDefinition => ({
    name: `shop_${action}`,
    description: action,
    parameters: { type: "object" },
    execute: async (args) => execute(args as Record<string, unknown>),
  });
  const browser = [
    tool("goto", ({ url }) => {
      if (url === "/down") return { error: "The page does not answer." };
      at = String(url);
      return state({ code: `await page.goto("${at}");` });
    }),
    tool("snapshot", () =>
      at === "/away"
        ? { url: "https://elsewhere.test/", title: "Elsewhere", page: "- text: Away" }
        : state({ page: PAGES[at]?.page ?? "", truncated: at === "/customers" }),
    ),
    tool("click", (args) => {
      clicked.push(args);
      if ((args["target"] as { name?: string }).name === "Ada") at = "/customers/ab12cd34";
      return state({ code: "await page.click();" });
    }),
    tool("fill", () => state({ code: "await page.fill();" })),
    tool("select_option", () => "done"),
    tool("check", () => state()),
    tool("screenshot", () => null),
  ];
  const trail = new ScreenTrail("shop", `${BASE}/`, mode);
  const journal = new Journal();
  const map = new ApplicationMap({ sourceId: "shop", trail, secrets: [], journal });
  const tools = [...trail.watched(browser), ...map.tools()];
  const call = (name: string, args: object = {}) => tools.find((candidate) => candidate.name === name)!.execute(args) as Promise<Told>;
  return { trail, map, journal, call, clicked };
}

const refusal = (what: string, ...problems: string[]) => ({
  error: [`Refused. ${what}. Fix what follows, and only that, then call the tool again.`, ...problems.map((problem) => `- ${problem}`)].join("\n"),
});
const left = (count: number, names: string) =>
  `${count} screens are in no domain and not set aside: ${names}. Next: place each with write_domain, or set it aside with set_aside; open with the browser tools a screen you have not opened yet.`;
const CUSTOMERS = { id: "customers", label: "Customers", description: "Finding a customer." };
/** Hands a domain in, and confirms it when the harness asks about a domain without any observation. */
const confirmed = async (call: (name: string, args: object) => Promise<Told>, domain: object): Promise<Told> => {
  const first = await call("write_domain", domain);
  return typeof first === "string" && first.startsWith("Warning: the domain") ? call("write_domain", domain) : first;
};

describe("the route of a screen", () => {
  it("is its path on the user interface, the same for every record, with the route an application writes after a #", () => {
    const base = new URL(`${BASE}/`);
    const route = (address: string) => screenRoute(address, base, base);
    assert.deepEqual(
      [
        "/customers?page=2",
        "/customers/42",
        "/customers/ab12cd34/orders",
        "/policies/0c1e2f3a-1111-2222-3333-444455556666",
        "/#/policies?sort=asc",
        "/v2/help",
      ].map(route),
      ["/customers", "/customers/:id", "/customers/:id/orders", "/policies/:id", "/#/policies", "/v2/help"],
    );
    // An address of another site is no screen, nor one that cannot be read.
    assert.deepEqual([route("https://elsewhere.test/docs"), route("http://[bad")], [undefined, undefined]);
  });
});

describe("what an agent saw of a user interface while it explored it", () => {
  it("gives back what the page shows after each action, and keeps the screens opened, what they showed and the links still to open", async () => {
    const { trail, call } = explored();
    assert.deepEqual([trail.visited.length, trail.pending.length], [0, 0]);
    const home = (await call("shop_goto", { url: "/" })) as unknown as { url: string; page: string; truncated?: boolean };
    assert.deepEqual([home.url, home.page, "truncated" in home], [`${BASE}/`, PAGES["/"]!.page, false]);
    // A link to another site is no screen; a link is a screen to open until it is opened.
    assert.deepEqual(
      [trail.visited.map((screen) => [screen.route, screen.title, screen.links]), trail.pending],
      [[["/", "Shop", ["/customers", "/logout"]]], ["/customers", "/logout"]],
    );
    const customers = (await call("shop_goto", { url: "/customers" })) as unknown as { truncated?: boolean };
    assert.equal(customers.truncated, true);
    await call("shop_click", { target: { role: "link", name: "Ada" }, confirm: true });
    assert.deepEqual(
      trail.visited.map((screen) => screen.route),
      ["/", "/customers", "/customers/:id"],
    );
    assert.deepEqual(trail.pending, ["/logout"]);
    // What a screen showed is what a line of its snapshots held, spaces and case aside; a link is no text.
    assert.deepEqual(
      [
        trail.shows("/customers", "2  CUSTOMERS"),
        trail.shows("/customers", "/customers/ab12cd34"),
        trail.shows("/customers/:id", "No orders yet"),
        trail.shows("/nowhere", "x"),
      ],
      [true, false, true, false],
    );
    // A route, a path or an address names a screen the trail knows; nothing else does.
    assert.deepEqual(
      [
        trail.route("/customers/:id"),
        trail.route("/customers/:customerId"),
        trail.route("/customers/99"),
        trail.route(`${BASE}/logout`),
        trail.route("/orders"),
        trail.route("https://elsewhere.test/"),
      ],
      ["/customers/:id", "/customers/:id", "/customers/:id", "/logout", undefined, undefined],
    );
  });

  it("passes on a call that fails or tells no page, and what a tool that acts on nothing answers", async () => {
    const { trail, call } = explored();
    assert.deepEqual(await call("shop_goto", { url: "/down" }), { error: "The page does not answer." });
    assert.equal(await call("shop_select_option"), "done");
    assert.equal(await call("shop_screenshot"), null);
    assert.equal(trail.visited.length, 0);
    // A page of another site is no screen of the application.
    await call("shop_goto", { url: "/away" });
    assert.equal(trail.visited.length, 0);
    // A screen the application names without a page is one all the same.
    await call("shop_goto", { url: "/customers" });
    await call("shop_check");
    assert.deepEqual(
      trail.visited.map((screen) => screen.route),
      ["/customers"],
    );
  });

  it("never clicks what removes data, nor what creates or changes some in an environment explored read-only", async () => {
    const reading = explored();
    await reading.call("shop_goto", { url: "/customers" });
    assert.deepEqual(await reading.call("shop_click", { target: { role: "button", name: "Delete customer" }, confirm: true }), {
      error:
        'Nothing was clicked: "Delete customer" may remove data of the application, and an exploration never removes any. Note that the screen offers it, and go on.',
    });
    assert.deepEqual(await reading.call("shop_click", { target: { role: "button", name: "Create customer" } }), {
      error:
        'Nothing was clicked: "Create customer" may create or change data, and this environment is explored without changing any. Read what the form asks — its fields, what is required, the rules the page states — note it, and go on.',
    });
    assert.deepEqual(reading.clicked, []);
    // Where data may be changed, a form is submitted; nothing is removed all the same, and no confirmation reaches the browser.
    const writing = explored("read-write");
    await writing.call("shop_goto", { url: "/customers" });
    assert.ok(!("error" in ((await writing.call("shop_click", { target: { role: "button", name: "Create customer" }, confirm: true })) as object)));
    assert.match(
      ((await writing.call("shop_click", { target: { role: "button", name: "Delete customer" } })) as { error: string }).error,
      /an exploration never removes any/,
    );
    assert.deepEqual(writing.clicked, [{ target: { role: "button", name: "Create customer" } }]);
  });
});

describe("the map of a user interface, handed in domain by domain", () => {
  it("is not over before anything is opened, and holds an element to a screen the agent opened", async () => {
    const { map, call } = explored();
    assert.deepEqual([map.closed, map.reminder()], [false, `You stopped before the end. ${left(1, "/ (not opened)")}`]);
    assert.deepEqual(
      await call("write_domain", { ...CUSTOMERS, elements: [{ screen: "/customers", role: "The customers." }], body: "x" }),
      refusal("The domain customers was not kept", "/customers is no screen of shop you opened or saw a link to. The screens so far: none."),
    );
    await call("shop_goto", { url: "/" });
    const elements = [
      { screen: "/customers", role: "The customers." },
      { screen: "/", feature: " ", role: "r" },
      { screen: "/", feature: "x".repeat(81), role: "r" },
      { screen: "/", feature: 5, role: "r" },
      { screen: "/orders", role: "r" },
    ];
    assert.deepEqual(
      await call("write_domain", { ...CUSTOMERS, elements, body: "x" }),
      refusal(
        "The domain customers was not kept",
        "You have not opened /customers: a link led to it. Open it with the browser tools, look at what it shows, then place it.",
        "Name what a user does on / in 80 characters at most, or leave feature out for the whole screen.",
        "Name what a user does on / in 80 characters at most, or leave feature out for the whole screen.",
        "Name what a user does on / in 80 characters at most, or leave feature out for the whole screen.",
        "/orders is no screen of shop you opened or saw a link to. The screens so far: /, /customers, /logout.",
      ),
    );
    // Past twenty screens, a refusal names the first twenty.
    const wide = explored();
    for (let at = 0; at < 22; at += 1) await wide.call("shop_goto", { url: `/s${at}/list` });
    const told = (await wide.call("set_aside", { elements: [{ screen: "/orders" }], reason: "r" })) as { error: string };
    assert.match(told.error, /The screens so far: \/s0\/list, .*, \/s19\/list, and 2 more\.$/);
    // A map of an application that was never opened leaves its home unplaced.
    const never = explored();
    const { exported, grouping } = await never.map.result();
    assert.deepEqual(
      exported.elements.map((element) => [element.name, element.summary, element.definition, grouping.state(element.name)]),
      [["/", "screen /, never opened", "", { unplaced: "The session of the agent ended before it was placed or set aside." }]],
    );
  });

  it("takes a screen whole or by what a user does on it, sets aside a screen a link led to, and names what is left", async () => {
    const { map, call } = explored();
    await call("shop_goto", { url: "/" });
    await call("shop_goto", { url: "/customers" });
    const elements = [
      { screen: "/customers", feature: "Search  a customer", role: "Finds a customer by name." },
      { screen: `${BASE}/customers`, feature: "Open a customer", role: "Opens the profile." },
    ];
    const body = "`/customers § Search a customer` then `/customers § Open a customer`.";
    assert.equal(
      await confirmed(call, { ...CUSTOMERS, elements, body }),
      `The domain customers is kept with 2 elements. ${left(3, "/, /logout (not opened), /customers/:id (not opened)")}`,
    );
    // A whole screen is not set aside once something done on it is placed; a link never opened may be.
    assert.deepEqual(
      await call("set_aside", { elements: [{ screen: "/customers" }, { screen: "/customers", feature: "Search a customer" }], reason: "r" }),
      refusal(
        "Nothing was set aside",
        "/customers is in the domain customers: a screen is placed or set aside, not both.",
        "/customers § Search a customer is in the domain customers: a screen is placed or set aside, not both.",
      ),
    );
    assert.equal(
      await call("set_aside", { elements: [{ screen: "/logout" }, { screen: "/" }], reason: "The home and the way out." }),
      `2 screens are set aside. ${left(1, "/customers/:id (not opened)")}`,
    );
    await call("shop_click", { target: { role: "link", name: "Ada" } });
    const profile = {
      id: "profiles",
      label: "Profiles",
      description: "A customer.",
      elements: [{ screen: "/customers/42", role: "The profile of a customer." }],
      body: "`/customers/:id`",
    };
    assert.equal(
      await confirmed(call, profile),
      "The domain profiles is kept with 1 elements. The whole source is placed or set aside. Answer with one sentence; call no more tools.",
    );
    assert.equal(map.closed, true);
    const { exported, grouping } = await map.result();
    assert.deepEqual(
      exported.elements.map((element) => [element.name, element.kind, element.summary, grouping.state(element.name)]),
      [
        [
          "/customers § Search a customer",
          "feature",
          "feature Search a customer of the screen /customers\n  links: /, /customers/:id",
          { domain: "customers", role: "Finds a customer by name." },
        ],
        [
          "/customers § Open a customer",
          "feature",
          "feature Open a customer of the screen /customers\n  links: /, /customers/:id",
          { domain: "customers", role: "Opens the profile." },
        ],
        ["/customers/:id", "screen", "screen /customers/:id — Ada", { domain: "profiles", role: "The profile of a customer." }],
        ["/logout", "screen", "screen /logout, never opened", { dismissed: "The home and the way out." }],
        ["/", "screen", "screen / — Shop\n  links: /customers, /logout", { dismissed: "The home and the way out." }],
      ],
    );
    assert.deepEqual(
      [exported.elements[2]!.definition, exported.elements[2]!.file.startsWith("screens/"), exported.elements[0]!.file.startsWith("features/")],
      [PAGES["/customers/ab12cd34"]!.page, true, true],
    );
  });

  it("keeps what the agent observed on a screen it opened, with the texts the screen showed, at the end of the file of the domain", async () => {
    const { map, call } = explored();
    await call("shop_goto", { url: "/" });
    await call("shop_goto", { url: "/customers" });
    const domain = { ...CUSTOMERS, elements: [{ screen: "/customers", role: "The customers." }], body: "`/customers` lists the customers." };
    const observations = [
      { screen: "/customers", statement: "The list  says\nhow many customers it holds.", shows: ["2 customers", 7] },
      { screen: "/customers", statement: "A customer is found by a search field." },
      { screen: "/customers", statement: "Unknown customers are refused.", shows: ["No customer found", "Search"] },
      { screen: "/logout", statement: "Leaving ends the session." },
      { screen: "/orders", statement: "s" },
      { screen: "/customers", statement: " " },
      { screen: "/customers", statement: "x".repeat(301) },
      { screen: "/customers", statement: 5 },
    ];
    assert.deepEqual(
      await call("write_domain", { ...domain, observations }),
      refusal(
        "The domain customers was not kept",
        '/customers never showed "No customer found". Copy the text as the page gives it, or leave it out of shows: an observation holds only what was seen.',
        "An observation is made on /logout, which you have not opened. Observe only what a screen showed you.",
        "/orders is no screen of shop you opened or saw a link to. The screens so far: /, /customers, /logout, /customers/:id.",
        "Say what you observed on /customers in one sentence of 300 characters at most.",
        "Say what you observed on /customers in one sentence of 300 characters at most.",
        "Say what you observed on /customers in one sentence of 300 characters at most.",
      ),
    );
    const many = Array.from({ length: 41 }, () => observations[1]);
    assert.match(
      ((await call("write_domain", { ...domain, observations: many })) as { error: string }).error,
      /- The domain has 41 observations, 40 at most\. Keep those a test can verify\./,
    );
    await call("write_domain", { ...domain, observations: observations.slice(0, 2) });
    const { files } = await map.result();
    assert.equal(
      files.get("customers")!.body,
      [
        "`/customers` lists the customers.",
        "",
        "## Observed on the screens",
        "",
        "What follows was seen while exploring the application, not read in a specification.",
        "",
        '- `/customers`: The list says how many customers it holds. Seen: "2 customers".',
        "- `/customers`: A customer is found by a search field.",
      ].join("\n"),
    );
    // A domain handed in without an observation is asked about once; confirmed, it has none added.
    assert.equal(
      await call("write_domain", domain),
      "Warning: the domain customers is not kept yet. You handed it in without any observation. Say what the application answered to what you tried on its screens, such as a search that finds nothing or an address that does not exist, with the texts it showed; if you saw nothing there a test can verify, call write_domain again with the same domain to confirm.",
    );
    await call("write_domain", domain);
    assert.equal((await map.result()).files.get("customers")!.body, "`/customers` lists the customers.");
  });
});

describe("the instructions and the request of the agent that explores an application", () => {
  it("say what it may do in the environment, its method, the grain of an element and what an observation is", () => {
    const reading = applicationExplorerInstructions("shop", "read-only");
    const writing = applicationExplorerInstructions("shop", "read-write");
    assert.match(reading, /\n- You change no data here\. .* never submit a form that creates, changes or removes anything\./);
    assert.match(writing, /\n- You may submit the forms that create or change data here, .* You never remove data: the harness refuses such a click\.\n/);
    for (const said of [
      "You explore the user interface of one application, as a tester who discovers it would",
      'Open the home with shop_goto and the path "/".',
      "A screen where a user does several things is cut",
      "Only what you saw: never what the application should do, nor what you suppose.",
      "Keep with remember what the agents after you should know and no screen says by itself",
    ])
      assert.ok(reading.includes(said), said);
    assert.doesNotMatch(reading, /[ \t]$/m);
    assert.equal(
      explorationRequest("shop", "local", `${BASE}/`),
      `Explore the user interface of shop (local), at ${BASE}/, and map what it does.\n\nNext: open its home with shop_goto and the path "/", then follow its menus and its links.`,
    );
  });
});
