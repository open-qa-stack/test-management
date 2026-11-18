import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { Problem, ProblemCode, Session, SessionEvent, SessionList, SessionOpening } from "@open-qa-stack/shared/sessions";
import { afterAll, beforeAll, describe, it } from "vitest";
import { COMPLETED, EVENTS, RUNNING, SESSION_ID } from "./agent/session-fixture.ts";
import type { Locator, Page } from "playwright-core";
import { BuiltConsole, UNREACHABLE, type Api, type ApiAnswer } from "./built-console.ts";

let built: BuiltConsole | undefined;

beforeAll(async () => {
  built = await BuiltConsole.start();
});

afterAll(async () => {
  await built?.stop();
});

function app(): BuiltConsole {
  assert.ok(built, "the console is built");
  return built;
}

/** The identifier of the session the played instance opens on request. */
const OPENED_ID = "oqas-2026-11-16T09-00-00-000Z";

/** The event that says the session of the fixtures completed, after all the others. */
const COMPLETION: SessionEvent = { id: EVENTS.length + 1, at: "2026-11-15T14:46:00.000Z", type: "state_changed", state: "completed" };

/**
 * A problem, as the API answers one.
 *
 * @param code - Its code.
 * @param status - Its status.
 * @param detail - What it says went wrong.
 * @returns The answer.
 */
function problem(code: ProblemCode, status: number, detail: string): ApiAnswer {
  const body: Problem = { type: `/problems/${code}`, title: "A problem", status, detail, code };
  return { status, contentType: "application/problem+json", body: JSON.stringify(body) };
}

/** The API of an instance that holds one session, which a test may change as it goes. */
class PlayedInstance {
  /** The session, as the API tells it now. */
  public session: Session = RUNNING;
  /** How many events the session has so far. */
  public happened = EVENTS.length;
  /** Whether the instance cannot be reached. */
  public down = false;
  /** Whether the list of the project has the session. */
  public listed = true;
  /** Whether the API fails to list the sessions. */
  public unlisted = false;
  /** Whether the API fails to open the stream of a session. */
  public streamDown = false;
  /** Why the API refuses to open a session, when it does. */
  public refusal: ProblemCode | undefined;
  /** What the API waits for before it answers a request to open a session. */
  public hold: Promise<void> = Promise.resolve();
  /** The requests to open a session the API received. */
  public readonly asked: SessionOpening[] = [];
  /** The event each stream of the session was asked to resume after; none for a stream asked from its start. */
  public readonly resumed: (string | undefined)[] = [];
  /** The session the API opened on request, once it did. */
  private opened: Session | undefined;

  /** Completes the session: its last event says so, and the API tells what it came to. */
  public complete(): void {
    this.happened = EVENTS.length;
    this.session = COMPLETED;
  }

  /** What the API does with a request. */
  public readonly api: Api = async ({ path, method, after, body }) => {
    if (this.down) return UNREACHABLE;
    if (path === "/api/project")
      return { body: JSON.stringify({ name: "lakeside", applications: [{ id: "customer-management", name: "Customer Management" }] }) };
    if (path === "/api/sessions" && method === "POST") {
      await this.hold;
      if (this.refusal !== undefined) return problem(this.refusal, 503, "The API refuses in its own words.");
      const asked = JSON.parse(body!) as SessionOpening;
      this.asked.push(asked);
      this.opened = { id: OPENED_ID, request: asked.request, openedAt: "2026-11-16T09:00:00.000Z", lastEventAt: "2026-11-16T09:00:00.000Z", state: "running" };
      return { status: 201, body: JSON.stringify(this.opened) };
    }
    if (path === "/api/sessions") {
      if (this.unlisted) return problem("error", 500, "The folder of the sessions cannot be read.");
      const items = [...(this.opened === undefined ? [] : [this.opened]), ...(this.listed ? [this.session] : [])];
      return { body: JSON.stringify({ items } satisfies SessionList) };
    }
    const [, id, stream] = /^\/api\/sessions\/([^/]+)(\/events)?$/.exec(path) ?? [];
    const session = id === SESSION_ID ? this.session : id === OPENED_ID ? this.opened : undefined;
    if (session === undefined) return problem("unknown_session", 404, "No session has this identifier.");
    if (stream === undefined) return { body: JSON.stringify(session) };
    if (this.streamDown) return problem("unavailable", 503, "The stream cannot be opened.");
    if (id !== SESSION_ID) return { contentType: "text/event-stream", body: ": nothing yet\n\n" };
    this.resumed.push(after);
    // The answer ends after what the session has so far: the console connects again, and asks for what happened since.
    const events = [...EVENTS.slice(0, this.happened), ...(session.state === "running" ? [] : [COMPLETION])].filter((event) => event.id > Number(after ?? 0));
    return { contentType: "text/event-stream", body: `: events\n\n${events.map((event) => `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`).join("")}` };
  };
}

/** The address of the session of the fixtures. */
const SESSION = `#/agent/sessions/${SESSION_ID}`;

/** The address of that session with the look of the page its planner opened, the seventh step of its thread. */
const LOOKED = `${SESSION}?look=6`;

/** The least side of what a finger presses, in CSS pixels. */
const TAP = 44;

/**
 * Tells how far a page is wider than its window.
 *
 * @param page - The page.
 * @returns The width that overflows, in CSS pixels; none when the page fits.
 */
function overflowOf(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Lists what a person can press on a page that a finger would miss.
 *
 * @param page - The page.
 * @returns Each link, button, folded block and field shown that is less than 44 px wide or high, with its size.
 */
function tooSmallOf(page: Page): Promise<string[]> {
  return page.evaluate(
    (least) =>
      [...document.querySelectorAll("a, button, summary, textarea")]
        .filter((element) => element.checkVisibility())
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width < least || box.height < least)
        .map(({ element, box }) => `${element.tagName} « ${element.getAttribute("aria-label") ?? element.textContent} » ${box.width} × ${box.height}`),
    TAP,
  );
}

/**
 * Names what holds the focus of a page.
 *
 * @param page - The page.
 * @returns Its tag and what it reads as, by its label or its text; `nothing` when the focus is on no element.
 */
function focusedOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    return element === null || element === document.body ? "nothing" : `${element.tagName}: ${element.getAttribute("aria-label") ?? element.textContent}`;
  });
}

/**
 * Waits until what slides an element into place has ended, so that it is measured where it stays.
 *
 * @param element - The element.
 */
async function settled(element: Locator): Promise<void> {
  await element.evaluate((moving) => Promise.all(moving.getAnimations().map((animation) => animation.finished)));
}

describe("the shell on a narrow and on a wide screen", () => {
  it("keeps the navigation within reach on a phone, beside the mark, without what is coming", async () => {
    const page = await app().open(390, "#/nowhere", new PlayedInstance().api);
    try {
      const bar = await page.locator(".top").boundingBox();
      const entry = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Agent" });
      const box = await entry.boundingBox();
      assert.ok(bar !== null && box !== null);
      assert.ok(box.x >= bar.x + bar.width && box.x + box.width <= 390, "the entry stands beside the mark, in the window");
      assert.ok(box.y >= bar.y && box.y + box.height <= bar.y + bar.height, "the entry stands in the top bar");
      assert.equal(await page.getByText("bientôt").first().isVisible(), false);
      assert.equal(await page.getByText("lakeside · projet").isVisible(), false);
      await entry.click();
      await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
    } finally {
      await page.close();
    }
  });

  it("keeps the navigation in the top bar at 1099 px", async () => {
    const page = await app().open(1099, "", new PlayedInstance().api);
    try {
      const bar = await page.locator(".top").boundingBox();
      const navigation = await page.locator(".nav").boundingBox();
      assert.ok(bar !== null && navigation !== null);
      assert.equal(navigation.y, bar.y);
      assert.equal(await page.getByText("bientôt").first().isVisible(), false);
    } finally {
      await page.close();
    }
  });

  it("shows the navigation as a sidebar at the left, with the project and what is coming, at 1100 px", async () => {
    const page = await app().open(1100, "", new PlayedInstance().api);
    try {
      const bar = await page.locator(".top").boundingBox();
      const sidebar = await page.locator(".shell-sidebar").boundingBox();
      assert.ok(bar !== null && sidebar !== null);
      assert.equal(sidebar.x, 0);
      assert.equal(sidebar.y, bar.y + bar.height);
      assert.equal(bar.width, 1100);
      assert.equal(await page.getByText("bientôt").count(), 6);
      assert.equal(await page.getByText("bientôt").first().isVisible(), true);
      await page.getByText("1 application · projet").waitFor();
    } finally {
      await page.close();
    }
  });

  it("lets no screen and no panel overflow the width of a small phone", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(360, "", instance.api);
    try {
      const overflowing: string[] = [];
      for (const [hash, shown] of [
        ["#/agent", ".run-row"],
        [SESSION, ".thread .turn-text"],
        [LOOKED, ".look-panel .look"],
        [`${SESSION}?show=verdicts&agent=planner`, ".followed-chip"],
        ["#/agent/sessions/oqas-gone", ".state"],
        ["#/nowhere", ".state"],
      ] as const) {
        await page.goto(`http://console.test/${hash}`);
        await page.locator(shown).first().waitFor();
        const overflow = await overflowOf(page);
        if (overflow > 0) overflowing.push(`${hash} by ${overflow} px`);
      }
      await page.goto(`http://console.test/${SESSION}`);
      await page.getByRole("button", { name: "Rejouer" }).click();
      await page.getByRole("button", { name: "Pause" }).waitFor();
      instance.down = true;
      await page.getByRole("alert").waitFor();
      assert.equal(await overflowOf(page), 0, "a replay under the band of an instance that no longer answers");
      assert.deepEqual(overflowing, []);
    } finally {
      await page.close();
    }
  });

  it("gives a finger 44 px at least on all that is pressed on the entry and on a session, on a phone", async () => {
    const page = await app().open(390, "#/agent", new PlayedInstance().api);
    try {
      await page.locator(".run-row").waitFor();
      assert.deepEqual(await tooSmallOf(page), []);
      for (const [hash, shown] of [
        [SESSION, ".thread .turn-agent"],
        [LOOKED, ".look-panel .look"],
      ] as const) {
        await page.goto(`http://console.test/${hash}`);
        await page.locator(shown).first().waitFor();
        assert.deepEqual(await tooSmallOf(page), [], hash);
      }
      await page.goto(`http://console.test/${SESSION}`);
      await page.getByRole("button", { name: "Rejouer" }).click();
      await page.getByRole("button", { name: "Pause" }).waitFor();
      assert.deepEqual(await tooSmallOf(page), [], "a replay");
      await page.goto("http://console.test/#/nowhere");
      await page.getByRole("link", { name: "Revenir aux sessions" }).waitFor();
      assert.deepEqual(await tooSmallOf(page), [], "a page that leads nowhere");
    } finally {
      await page.close();
    }
  });

  it("writes the request in a field of 16 px at least, which a phone does not zoom on", async () => {
    const page = await app().open(390, "#/agent", new PlayedInstance().api);
    try {
      const size = await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).evaluate((field) => parseFloat(getComputedStyle(field).fontSize));
      assert.ok(size >= 16, `${size} px`);
    } finally {
      await page.close();
    }
  });
});

describe("what an agent had before its eyes", () => {
  /** The eye of the action that opened the page of the application. */
  const EYE = "A: A ouvert / dans customer-management — voir ce que l’agent avait sous les yeux";

  it("is closed by default: a session is its thread alone, in one centred column on a wide screen", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      try {
        await page.getByText("I write the test now.").waitFor();
        assert.equal(await page.getByRole("dialog").count(), 0, `${width}`);
        assert.equal(await page.locator(".act.selected").count(), 0, `${width}`);
        const thread = await page.locator(".thread").boundingBox();
        const around = await page.locator(".content").boundingBox();
        assert.ok(thread !== null && around !== null);
        assert.ok(thread.width <= 880, `${width}: a column of ${thread.width} px`);
        assert.ok(Math.abs(thread.x - around.x - (around.x + around.width - thread.x - thread.width)) <= 1, `${width}: centred`);
        assert.equal(await overflowOf(page), 0, `${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("opens from the eye of an action, on that action, named after it, and takes the focus", async () => {
    const page = await app().open(1440, SESSION, new PlayedInstance().api);
    try {
      await page.getByText("I write the test now.").waitFor();
      await page.getByRole("link", { name: /voir ce que l’agent avait sous les yeux/ }).click();
      const panel = page.getByRole("dialog", { name: "Sous les yeux de l’agent A ouvert / dans customer-management" });
      await panel.waitFor();
      assert.equal(new URL(page.url()).hash, LOOKED);
      await panel.getByText('heading "Customers"').waitFor();
      assert.equal(await page.locator(".act.selected .act-title").innerText(), "A ouvert / dans customer-management");
      assert.equal(await page.locator(".act.selected").count(), 1);
      assert.equal(await focusedOf(page), "H2: Sous les yeux de l’agent");
    } finally {
      await page.close();
    }
  });

  it("closes by its link, by Escape and by the way back, and gives the focus back to the eye, in the window", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      const closings: readonly (readonly [string, () => Promise<unknown>])[] = [
        ["its link", () => page.getByRole("dialog").getByRole("link", { name: "Fermer" }).click()],
        ["Escape", () => page.keyboard.press("Escape")],
        ["the way back", () => page.goBack()],
      ];
      try {
        await page.setViewportSize({ width, height: 420 });
        await page.getByText("I write the test now.").waitFor();
        const eye = page.getByRole("link", { name: /voir ce que l’agent avait sous les yeux/ });
        for (const [name, close] of closings) {
          await eye.click();
          await page.getByRole("dialog").waitFor();
          await close();
          await page.getByRole("dialog").waitFor({ state: "detached" });
          assert.equal(new URL(page.url()).hash, SESSION, `${width}, ${name}`);
          assert.equal(await focusedOf(page), EYE, `${width}, ${name}`);
          const box = await eye.boundingBox();
          assert.ok(box !== null && box.y >= 0 && box.y + box.height <= 420, `${width}, ${name}: the eye is at ${box?.y}`);
        }
      } finally {
        await page.close();
      }
    }
  });

  it("covers the whole screen of a phone and of a tablet, and holds the page behind it still", async () => {
    for (const width of [390, 1099]) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      try {
        await page.setViewportSize({ width, height: 420 });
        await page.getByText("I write the test now.").waitFor();
        await page.evaluate(() => window.scrollTo(0, 120));
        await page.getByRole("link", { name: /voir ce que l’agent avait sous les yeux/ }).click();
        const panel = page.getByRole("dialog");
        await panel.getByText('heading "Customers"').waitFor();
        await settled(panel);
        assert.deepEqual(await panel.boundingBox(), { x: 0, y: 0, width, height: 420 }, `${width}`);
        assert.equal(await overflowOf(page), 0, `${width}`);
        assert.deepEqual(await tooSmallOf(page), [], `${width}`);
        const scrolled = await page.evaluate(() => window.scrollY);
        await page.mouse.move(width / 2, 300);
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(200);
        assert.equal(await page.evaluate(() => window.scrollY), scrolled, `${width}: the page behind did not scroll`);
      } finally {
        await page.close();
      }
    }
  });

  it("is a drawer at the right of a wide screen, as tall as the window, beside a thread that stays whole and scrolls", async () => {
    for (const width of [1100, 1440]) {
      const page = await app().open(width, LOOKED, new PlayedInstance().api);
      try {
        await page.setViewportSize({ width, height: 420 });
        const panel = page.getByRole("dialog");
        await panel.getByText('heading "Customers"').waitFor();
        await settled(panel);
        const drawer = await panel.boundingBox();
        const thread = await page.locator(".thread").boundingBox();
        assert.ok(drawer !== null && thread !== null);
        assert.deepEqual([drawer.x + drawer.width, drawer.y, drawer.height], [width, 0, 420], `${width}`);
        assert.ok(drawer.width >= 420 && drawer.width <= 560, `${width}: a drawer of ${drawer.width} px`);
        assert.ok(
          thread.width >= 360 && thread.x + thread.width <= drawer.x,
          `${width}: the thread ends at ${thread.x + thread.width}, the drawer starts at ${drawer.x}`,
        );
        assert.equal(await page.getByText("I write the test now.").isVisible(), true);
        assert.equal(await overflowOf(page), 0, `${width}`);
        await page.mouse.move(thread.x + 40, 300);
        await page.mouse.wheel(0, 200);
        await page.waitForFunction(() => window.scrollY > 0);
        assert.deepEqual(await panel.boundingBox(), drawer, `${width}: the drawer stays while the thread scrolls`);
      } finally {
        await page.close();
      }
    }
  });

  it("opens nothing for an address whose look names no action that looked at something", async () => {
    for (const look of ["99", "5", "page"]) {
      const page = await app().open(390, `${SESSION}?look=${look}`, new PlayedInstance().api);
      try {
        await page.getByText("I write the test now.").waitFor();
        assert.equal(await page.getByRole("dialog").count(), 0, look);
        assert.equal(await page.locator(".act.selected").count(), 0, look);
        assert.equal(await page.locator(".thread").isVisible(), true, look);
      } finally {
        await page.close();
      }
    }
  });
});

describe("the thread of a session", () => {
  it("follows an agent from its name in the thread, which then shows that agent alone, until its chip is pressed", async () => {
    const page = await app().open(390, SESSION, new PlayedInstance().api);
    try {
      const thread = page.getByRole("region", { name: "Fil de la session" });
      await thread.getByText("I write the test now.").waitFor();
      await thread.getByRole("link", { name: "Planificateur : ne voir que cet agent" }).click();
      const chip = page.getByRole("link", { name: "Ne plus suivre Planificateur" });
      await chip.waitFor();
      assert.equal(new URL(page.url()).hash, `${SESSION}?agent=planner`);
      assert.deepEqual(await thread.locator(".turn-agent").allInnerTexts(), ["Planificateur"]);
      assert.equal(await thread.getByText("I write the test now.").count(), 0);
      assert.equal(await thread.getByRole("link", { name: "Planificateur : voir tous les agents" }).count(), 1);
      assert.deepEqual(await tooSmallOf(page), []);
      await chip.click();
      await thread.getByText("I write the test now.").waitFor();
      assert.equal(new URL(page.url()).hash, SESSION);
      assert.deepEqual(await thread.locator(".turn-agent").allInnerTexts(), ["Planificateur", "Rédacteur"]);
    } finally {
      await page.close();
    }
  });

  it("keeps the passes of a session on one line on a phone", async () => {
    const page = await app().open(360, SESSION, new PlayedInstance().api);
    try {
      await page.getByText("I write the test now.").waitFor();
      const steps = await page.locator(".pass-step").evaluateAll((all) => all.map((step) => step.getBoundingClientRect().top));
      assert.ok(steps.length > 1);
      assert.equal(new Set(steps).size, 1);
    } finally {
      await page.close();
    }
  });

  it("moves nothing for a person who asked for less motion, while the agents work", async () => {
    const page = await app().open(390, SESSION, new PlayedInstance().api);
    const moving = (): Promise<number> => page.evaluate(() => document.getAnimations().length);
    try {
      await page.getByRole("status").filter({ hasText: "travaille" }).waitFor();
      assert.ok((await moving()) > 0, "the console shows who works by what moves");
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(await moving(), 0);
    } finally {
      await page.close();
    }
  });
});

describe("the console in a browser", () => {
  it("lists the sessions of the project and opens the thread of the one a person picks", async () => {
    const page = await app().open(1280, "", new PlayedInstance().api);
    try {
      await page.getByRole("link", { name: /tester la recherche d'un client/ }).click();
      await page.getByText("I write the test now.").waitFor();
      assert.equal(new URL(page.url()).hash, `#/agent/sessions/${SESSION_ID}`);
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "tester la recherche d'un client");
      await page.goBack();
      await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
    } finally {
      await page.close();
    }
  });

  it("fills the thread while the agents work, each event once, then shows the verdict when the session completes", async () => {
    const instance = new PlayedInstance();
    instance.happened = 6;
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      const reasoning = page.locator(".thinking-text", { hasText: "I should open the application first." });
      await reasoning.waitFor({ state: "attached" });
      await page.getByRole("status").filter({ hasText: "travaille" }).waitFor();
      assert.equal(await page.getByText("I write the test now.").count(), 0);
      instance.happened = EVENTS.length;
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await reasoning.count(), 1);
      assert.deepEqual(instance.resumed.slice(0, 2), [undefined, "6"]);
      instance.complete();
      await page.getByText("Verdict de l’exécution : 1 test(s)").waitFor();
      assert.equal(await page.getByRole("status").filter({ hasText: "travaille" }).count(), 0);
      assert.equal(instance.resumed.at(-1), String(EVENTS.length));
    } finally {
      await page.close();
    }
  });

  it("stops asking for the events of a session once its stream said it completed", async () => {
    const instance = new PlayedInstance();
    instance.complete();
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      await page.getByText("Verdict de l’exécution : 1 test(s)").waitFor();
      await page.waitForTimeout(1500);
      assert.deepEqual(instance.resumed, [undefined]);
    } finally {
      await page.close();
    }
  });

  it("recovers by itself, without a reload, when the stream of a session was refused then opens again", async () => {
    const instance = new PlayedInstance();
    instance.happened = 6;
    instance.streamDown = true;
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      await page.getByText("connexion au flux interrompue, nouvelle tentative…").waitFor();
      assert.equal(await page.locator(".thinking-text").count(), 0);
      instance.streamDown = false;
      await page.locator(".thinking-text", { hasText: "I should open the application first." }).waitFor({ state: "attached" });
      instance.streamDown = true;
      await page.getByText("connexion au flux interrompue, nouvelle tentative…").waitFor();
      instance.happened = EVENTS.length;
      instance.streamDown = false;
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await page.locator(".thinking-text", { hasText: "I should open the application first." }).count(), 1);
      assert.deepEqual(instance.resumed.slice(0, 2), [undefined, "6"]);
      assert.equal(await page.getByRole("alert").count(), 0);
    } finally {
      await page.close();
    }
  });

  it("opens by its address a session the list of the project does not have", async () => {
    const instance = new PlayedInstance();
    instance.listed = false;
    const page = await app().open(1280, `#/agent/sessions/${SESSION_ID}`, instance.api);
    try {
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "tester la recherche d'un client");
      await page.getByRole("link", { name: "Agent", exact: true }).first().click();
      await page.getByText("Aucune session pour l’instant").waitFor();
    } finally {
      await page.close();
    }
  });

  it("says a session is not found when the instance keeps none of that name", async () => {
    const page = await app().open(1280, "#/agent/sessions/oqas-gone", new PlayedInstance().api);
    try {
      await page.getByRole("heading", { level: 1, name: "Session introuvable" }).waitFor();
      assert.equal(await page.title(), "Session introuvable · Open QA Stack");
    } finally {
      await page.close();
    }
  });

  it("names the page after the screen, and moves the focus to its heading, as the person goes from one to another", async () => {
    const page = await app().open(1280, "#/agent", new PlayedInstance().api);
    const focused = (): Promise<string> => focusedOf(page);
    try {
      const link = page.getByRole("link", { name: /tester la recherche d'un client/ });
      await link.waitFor();
      assert.equal(await page.title(), "Agent · Open QA Stack");
      assert.equal(await focused(), "nothing");
      await link.click();
      await page.getByText("I write the test now.").waitFor();
      assert.equal(await page.title(), "tester la recherche d'un client · Open QA Stack");
      assert.equal(await focused(), "H1: tester la recherche d'un client");
      await page.getByRole("link", { name: "Échanges" }).click();
      await page.waitForURL(/show=talk/);
      assert.equal(await focused(), "A: Échanges");
      await page.goto("http://console.test/#/nowhere");
      await page.getByRole("heading", { level: 1, name: "Page introuvable" }).waitFor();
      assert.equal(await page.title(), "Page introuvable · Open QA Stack");
      assert.equal(await focused(), "H1: Page introuvable");
      await page.goBack();
      await page.goBack();
      await page.goBack();
      await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
      assert.equal(await page.title(), "Agent · Open QA Stack");
      assert.equal(await focused(), "H1: Qu’est-ce qu’on teste ?");
    } finally {
      await page.close();
    }
  });

  it("opens the session a person asks for, and goes to its thread", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("  vérifier le changement d'adresse  ");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByRole("heading", { level: 1, name: "vérifier le changement d'adresse" }).waitFor();
      assert.equal(new URL(page.url()).hash, `#/agent/sessions/${OPENED_ID}`);
      assert.deepEqual(instance.asked, [{ request: "vérifier le changement d'adresse" }]);
    } finally {
      await page.close();
    }
  });

  it("leaves a person who went elsewhere while the session opened where they are, the session listed when they come back", async () => {
    const instance = new PlayedInstance();
    let release = (): void => {};
    instance.hold = new Promise((resolve) => (release = resolve));
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByRole("button", { name: "Ouverture…" }).waitFor();
      await page.goto("http://console.test/#/nowhere");
      await page.getByRole("heading", { level: 1, name: "Page introuvable" }).waitFor();
      release();
      await page.waitForResponse((response) => response.request().method() === "POST");
      await page.getByRole("link", { name: "Revenir aux sessions" }).click();
      await page.getByRole("link", { name: /vérifier le changement d'adresse/ }).waitFor();
      assert.equal(new URL(page.url()).hash, "#/agent");
    } finally {
      await page.close();
    }
  });

  it("says in its own words why the instance refused to open a session, and stays on the entry", async () => {
    const instance = new PlayedInstance();
    instance.refusal = "unavailable";
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByText("Aucune source de sessions n’est configurée sur cette instance.").waitFor();
      assert.equal(new URL(page.url()).hash, "#/agent");
    } finally {
      await page.close();
    }
  });

  it("says the instance cannot be reached, and recovers by itself when it can again", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("link", { name: /tester la recherche d'un client/ }).waitFor();
      instance.down = true;
      await page.getByRole("alert").waitFor();
      instance.down = false;
      await page.getByRole("alert").waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  });

  it("says why the instance could not list the sessions, without saying it is offline, then lists them when it can", async () => {
    const instance = new PlayedInstance();
    instance.unlisted = true;
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("status").filter({ hasText: "The folder of the sessions cannot be read." }).waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
      instance.unlisted = false;
      await page.getByRole("link", { name: /tester la recherche d'un client/ }).waitFor();
      assert.equal(await page.getByRole("alert").count(), 0);
    } finally {
      await page.close();
    }
  });
});

describe("the code of the console is covered in full", () => {
  it("runs every line of the entry point and of the application when the console is used in the browser", async () => {
    const source = (await readFile(new URL("../src/main.tsx", import.meta.url), "utf8")).split("\n");
    const mount = source.findIndex((line) => line.startsWith("createRoot(")) + 1;
    const instance = new PlayedInstance();
    instance.unlisted = true;
    const [main, application] = await app().measure(
      ["src/main.tsx", "src/app.tsx"],
      async (page) => {
        await page.getByRole("status").filter({ hasText: "The folder of the sessions cannot be read." }).waitFor();
        instance.unlisted = false;
        await page.getByRole("link", { name: /tester la recherche d'un client/ }).click();
        await page.getByText("I write the test now.").waitFor();
        await page
          .getByRole("link", { name: /voir ce que l’agent avait sous les yeux/ })
          .first()
          .click();
        await page.locator(".act.selected").waitFor();
        await page.getByRole("dialog", { name: /^Sous les yeux de l’agent/ }).waitFor();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Rejouer" }).click();
        await page.getByRole("button", { name: "Pause" }).waitFor();
        await page.waitForFunction(() => Number(document.querySelector(".playback-progress")?.getAttribute("aria-valuenow")) > 0);
        await page.getByRole("button", { name: "Changer la vitesse" }).click();
        await page.getByRole("button", { name: "Pause" }).click();
        await page.getByRole("button", { name: "Reprendre" }).waitFor();
        await page.getByRole("button", { name: "Aller à la prochaine décision du harnais" }).click();
        await page.getByText("Plan accepté par le harnais").waitFor();
        await page.getByRole("button", { name: "Revenir au direct" }).click();
        await page.getByRole("button", { name: "Rejouer" }).waitFor();
        instance.down = true;
        await page.getByRole("alert").waitFor();
        instance.down = false;
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("   ");
        await page
          .locator("form.agent-home-prompt")
          .evaluate((form: HTMLFormElement) => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
        instance.refusal = "session_running";
        await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.getByText("Une session est déjà en cours").waitFor();
        instance.refusal = undefined;
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.getByRole("heading", { level: 1, name: "vérifier le changement d'adresse" }).waitFor();
      },
      instance.api,
    );
    assert.ok(main!.lines.includes(mount), `line ${mount} of src/main.tsx, the mount, is in the build`);
    assert.deepEqual(main!.uncovered, []);
    assert.ok(application!.lines.length > 20, "the application is in the build");
    assert.deepEqual(application!.uncovered, []);
  });
});
