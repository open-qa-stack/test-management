import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, it } from "vitest";
import { EVENTS, SESSION_ID } from "./agent/session-fixture.ts";
import type { Locator, Page } from "playwright-core";
import { BuiltConsole } from "./built-console.ts";
import { ConfiguredInstance } from "./configuration/configured-instance.ts";
import { DocumentedInstance } from "./knowledge/documented-instance.ts";
import { DETAIL, EXECUTIONS } from "./executions/executions-fixture.ts";
import { ListedInstance } from "./tests/listed-instance.ts";
import { OPENED_ID, PlayedInstance } from "./played-instance.ts";

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
 * @returns Each link, button, folded block and field shown that is less than 44 px wide or high, with its size,
 * read to the hundredth of a pixel: a box laid out at a fraction of a pixel is not measured exactly.
 */
function tooSmallOf(page: Page): Promise<string[]> {
  return page.evaluate(
    (least) =>
      [...document.querySelectorAll("a, button, summary, textarea")]
        .filter((element) => element.checkVisibility())
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => Math.round(box.width * 100) < least * 100 || Math.round(box.height * 100) < least * 100)
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
      assert.equal(await page.getByText("bientôt").count(), 4);
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
  const EYE = "A: A ouvert / dans customer-management — voir la page consultée";

  it("is closed by default: a session is its thread alone, in one column that starts where the title of the page does", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      try {
        await page.getByText("I write the test now.").waitFor();
        assert.equal(await page.getByRole("dialog").count(), 0, `${width}`);
        assert.equal(await page.locator(".act.selected").count(), 0, `${width}`);
        const thread = await page.locator(".thread").boundingBox();
        const title = await page.getByRole("heading", { level: 1 }).boundingBox();
        assert.ok(thread !== null && title !== null);
        assert.ok(thread.width <= 860, `${width}: a column of ${thread.width} px`);
        const edges = await page
          .locator(".crumb, .session-bar, .pass-stepper, .thread-filters, .composer")
          .evaluateAll((all) => all.map((one) => one.getBoundingClientRect().x));
        assert.deepEqual(edges, [title.x, title.x, title.x, title.x, title.x], `${width}: one left edge`);
        assert.equal(thread.x, title.x, `${width}: the thread starts where the title does`);
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
      await page.getByRole("link", { name: /voir la page consultée/ }).click();
      const panel = page.getByRole("dialog", { name: "Page consultée customer-management · http://localhost:3020/" });
      await panel.waitFor();
      assert.equal(new URL(page.url()).hash, LOOKED);
      await panel.getByText('heading "Customers"').waitFor();
      assert.equal(await page.locator(".act.selected .act-title").innerText(), "A ouvert / dans customer-management");
      assert.equal(await page.locator(".act.selected").count(), 1);
      assert.equal(await focusedOf(page), "H2: Page consultée");
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
        const eye = page.getByRole("link", { name: /voir la page consultée/ });
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
        await page.getByRole("link", { name: /voir la page consultée/ }).click();
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

  it("starts what an agent did and what the harness says on one keyline, beside the pictures, at every width, and ends every time on one edge", async () => {
    for (const [width, keyline] of [
      [390, 44],
      [1440, 44],
    ] as const) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      try {
        await page.getByText("I write the test now.").waitFor();
        const thread = await page.locator(".thread").boundingBox();
        assert.ok(thread !== null);
        const starts = await page
          .locator(".turn-body > :not(.turn-head), .brief .speaker-mark, .verdict, .result-card, .pass.minor .pass-title")
          .evaluateAll((all) => [...new Set(all.map((one) => one.getBoundingClientRect().left))]);
        assert.deepEqual(starts, [thread.x + keyline], `${width}: one keyline`);
        const texts = await page
          .locator(".brief summary > span:not([class]), .note-text")
          .evaluateAll((all) => [...new Set(all.map((one) => one.getBoundingClientRect().left))]);
        assert.deepEqual(texts, [thread.x + keyline + 28], `${width}: the harness speaks from one edge, after the room of its mark`);
        const held = await page
          .locator(".act-line, .thinking svg, .lead")
          .evaluateAll((all) => [...new Set(all.map((one) => one.getBoundingClientRect().left))]);
        assert.deepEqual(held, [thread.x + keyline + 16], `${width}: what a surface holds is set in by one padding`);
        const ends = await page
          .locator(".turn-head .turn-at, .brief .turn-at, .verdict .turn-at, .result-card .turn-at, .act-time")
          .evaluateAll((all) => [...new Set(all.map((one) => one.getBoundingClientRect().right))]);
        assert.deepEqual(ends, [thread.x + thread.width - 16], `${width}: one right edge for the times`);
      } finally {
        await page.close();
      }
    }
  });

  it("folds a long refusal to its first lines, and unfolds it in place to its end, which says what to do, from a button a finger can press", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      try {
        const text = page.locator(".verdict-text");
        const button = page.getByRole("button", { name: "Lire la suite" });
        await button.waitFor();
        const folded = await text.evaluate((element) => [element.scrollHeight > element.clientHeight, element.clientHeight] as const);
        assert.equal(folded[0], true, `${width}: the end is hidden while folded`);
        assert.equal(await button.getAttribute("aria-expanded"), "false");
        if (width < 1100) assert.deepEqual(await tooSmallOf(page), []);
        await button.click();
        const unfolded = page.getByRole("button", { name: "Replier", exact: true });
        assert.equal(await unfolded.getAttribute("aria-expanded"), "true");
        assert.equal(await text.evaluate((element) => element.scrollHeight <= element.clientHeight), true, `${width}: the whole text shows`);
        assert.ok((await text.evaluate((element) => element.clientHeight)) > folded[1]);
        await text.filter({ hasText: /then propose the plan again\.$/ }).waitFor();
        await unfolded.click();
        await button.waitFor();
      } finally {
        await page.close();
      }
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

describe("what the person says to the agents while they work", () => {
  /** The field of the composer. */
  const fieldOf = (page: Page): Locator => page.getByRole("textbox", { name: "Dites aux agents ce qu’il faut corriger" });

  /** Tells whether something ends at the bottom of the window, to the pixel: a page whose height is a fraction of one is not laid out more exactly. */
  const atBottom = (end: number): boolean => Math.abs(end - 800) < 1;

  /** The bubble of a message the person sent, with where it is under it. */
  const sentOf = (page: Page, text: string): Locator => page.locator(".sent", { hasText: text });

  it("is sent by the button, shows as a bubble of the person once the instance took it, then says which agent received it", async () => {
    const instance = new PlayedInstance();
    let release = (): void => {};
    instance.hold = new Promise((resolve) => (release = resolve));
    const page = await app().open(1280, SESSION, instance.api);
    try {
      const field = fieldOf(page);
      const button = page.getByRole("button", { name: "Envoyer" });
      await field.fill("  sans le profil  ");
      await button.click();
      await page.locator(".composer textarea:disabled").waitFor();
      assert.equal(await button.isDisabled(), true);
      assert.equal(await page.locator(".sent").count(), 0, "nothing shows before the instance took the message");
      release();
      const sent = sentOf(page, "sans le profil");
      await sent.getByText("en attente d’un agent").waitFor();
      assert.deepEqual(instance.said, [{ text: "sans le profil" }]);
      assert.deepEqual([await field.inputValue(), await field.isDisabled(), await button.isDisabled()], ["", false, false]);
      assert.equal(await field.evaluate((element) => element === document.activeElement), true, "the field keeps the focus");
      instance.deliver(1, "writer");
      await sent.getByText("remis à Rédacteur").waitFor();
      assert.match(await sent.locator(".request").innerText(), /^Votre message :\s+sans le profil$/);
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "tester la recherche d'un client");
      assert.equal(await page.title(), "tester la recherche d'un client · Open QA Stack");
    } finally {
      await page.close();
    }
  });

  it("is sent by Enter, while Shift+Enter starts a new line; an empty one is not sent", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, SESSION, instance.api);
    try {
      const field = fieldOf(page);
      await field.fill("   ");
      await field.press("Enter");
      await field.fill("sans le profil");
      await field.press("Shift+Enter");
      await field.pressSequentially("ni les contrats");
      assert.equal(await field.inputValue(), "sans le profil\nni les contrats");
      assert.deepEqual(instance.said, []);
      await field.press("Enter");
      await sentOf(page, "ni les contrats").waitFor();
      assert.deepEqual(instance.said, [{ text: "sans le profil\nni les contrats" }]);
      assert.equal(await field.inputValue(), "");
      const lines = await sentOf(page, "ni les contrats")
        .locator(".request")
        .evaluate((bubble) => bubble.getClientRects().length > 0 && bubble.clientHeight);
      assert.ok(Number(lines) > 60, "the bubble keeps the two lines the person wrote");
    } finally {
      await page.close();
    }
  });

  it("keeps what the person wrote and says why, over a thread still in sight, when the session just ended, then sends it once the instance takes it", async () => {
    const instance = new PlayedInstance();
    instance.deaf = true;
    const page = await app().open(390, SESSION, instance.api);
    try {
      const field = fieldOf(page);
      await field.fill("sans le profil");
      await page.getByRole("button", { name: "Envoyer" }).click();
      const alert = page.getByRole("alert");
      await alert.waitFor();
      assert.equal(
        await alert.innerText(),
        "La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.",
      );
      assert.deepEqual([await field.inputValue(), await field.isDisabled()], ["sans le profil", false]);
      assert.equal(await field.evaluate((element) => element === document.activeElement), true, "the field takes the focus back");
      assert.equal(await page.locator(".sent").count(), 0);
      await page.waitForFunction(() => {
        const composer = document.querySelector(".composer")!.getBoundingClientRect();
        return composer.bottom > window.innerHeight - 1 && document.querySelector(".working")!.getBoundingClientRect().bottom <= composer.top;
      });
      instance.deaf = false;
      await field.press("Enter");
      await sentOf(page, "sans le profil").waitFor();
      assert.equal(await alert.count(), 0);
    } finally {
      await page.close();
    }
  });

  it("stays once the session ended, as what goes on with it: what the person sends then resumes it, and its new turn shows under the verdict", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, SESSION, instance.api);
    try {
      await fieldOf(page).waitFor();
      instance.complete();
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
      const next = page.getByRole("textbox", { name: "Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…" });
      await next.waitFor();
      assert.equal(await page.getByRole("button", { name: "Envoyer" }).count(), 0);
      await page.reload();
      await next.fill("corriger le test en échec");
      await page.getByRole("button", { name: "Poursuivre la session" }).click();
      await page.locator(".session-bar .badge", { hasText: "en direct" }).waitFor();
      assert.deepEqual(instance.resumedWith, [{ text: "corriger le test en échec" }]);
      // The session is live again before its stream told the request of the new turn: the thread is read once it did.
      await page.locator(".thread-item", { hasText: "corriger le test en échec" }).waitFor();
      const turns = await page.locator(".thread-item").allInnerTexts();
      const verdict = turns.findIndex((text) => text.includes("Verdict de l’exécution"));
      assert.ok(verdict >= 0 && turns[verdict + 1]?.includes("corriger le test en échec"), "the new turn starts under the verdict of the one before");
      await page.getByRole("button", { name: "Envoyer" }).waitFor();
      assert.equal(await fieldOf(page).inputValue(), "");
    } finally {
      await page.close();
    }
  });

  it("stays at the bottom of a phone, over the end of the thread, which a new message scrolls into sight above it", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(390, SESSION, instance.api);
    /** The bottom of an element, and the top and the bottom of the composer, in the window. */
    const over = (above: Locator): Promise<readonly [number, number, number]> =>
      above.evaluate((element) => {
        const composer = document.querySelector(".composer")!.getBoundingClientRect();
        return [element.getBoundingClientRect().bottom, composer.top, composer.bottom] as const;
      });
    try {
      const working = page.getByRole("status").filter({ hasText: "travaille" });
      await working.waitFor();
      await page.waitForFunction(() => window.scrollY > 0);
      const [end, top, bottom] = await over(working);
      assert.ok(atBottom(bottom), `the composer stands at the bottom of the window: ${bottom}`);
      assert.ok(end <= top, `the thread ends at ${end}, over the composer, which starts at ${top}`);
      assert.deepEqual(await tooSmallOf(page), []);
      assert.equal(await overflowOf(page), 0);
      const size = await fieldOf(page).evaluate((field) => parseFloat(getComputedStyle(field).fontSize));
      assert.ok(size >= 16, `a field of ${size} px`);
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(atBottom((await over(working))[2]), "the composer stays there while the thread scrolls");
      assert.equal(await working.evaluate((element) => element.getBoundingClientRect().top > window.innerHeight), true);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await fieldOf(page).fill("sans le profil");
      await fieldOf(page).press("Enter");
      const sent = sentOf(page, "sans le profil");
      await sent.waitFor();
      await page.waitForFunction(() => {
        const status = document.querySelector('.working[role="status"]')!.getBoundingClientRect();
        return status.bottom <= document.querySelector(".composer")!.getBoundingClientRect().top && status.top > 0;
      });
      assert.equal(await sent.isVisible(), true);
      assert.equal(await overflowOf(page), 0);
      assert.deepEqual(await tooSmallOf(page), []);
    } finally {
      await page.close();
    }
  });

  it("stands at the bottom of the window however short the thread, which does not scroll then", async () => {
    const instance = new PlayedInstance();
    instance.happened = 2;
    for (const width of [390, 1440]) {
      const page = await app().open(width, SESSION, instance.api);
      try {
        await page.getByRole("status").filter({ hasText: "travaille" }).waitFor();
        const composer = await page.locator(".composer").boundingBox();
        assert.ok(composer !== null);
        assert.ok(atBottom(composer.y + composer.height), `${width}`);
        assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), 800, `${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("stays under the thread beside the drawer of a look on a wide screen, and behind the look that covers a phone", async () => {
    const wide = await app().open(1440, LOOKED, new PlayedInstance().api);
    try {
      const panel = wide.getByRole("dialog");
      await panel.getByText('heading "Customers"').waitFor();
      await settled(panel);
      const drawer = await panel.boundingBox();
      const thread = await wide.locator(".thread").boundingBox();
      const composer = await wide.locator(".composer").boundingBox();
      assert.ok(drawer !== null && thread !== null && composer !== null);
      assert.deepEqual([composer.x, composer.width], [thread.x, thread.width]);
      assert.ok(atBottom(composer.y + composer.height), `the composer ends at ${composer.y + composer.height}`);
      assert.ok(composer.x + composer.width <= drawer.x, `the composer ends at ${composer.x + composer.width}, the drawer starts at ${drawer.x}`);
      await fieldOf(wide).fill("sans le profil");
      assert.equal(await fieldOf(wide).inputValue(), "sans le profil", "the composer still takes what is written beside the drawer");
    } finally {
      await wide.close();
    }
    const phone = await app().open(390, LOOKED, new PlayedInstance().api);
    try {
      const panel = phone.getByRole("dialog");
      await panel.getByText('heading "Customers"').waitFor();
      await settled(panel);
      const covered = await phone.locator(".composer textarea").evaluate((field) => {
        const box = field.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest(".look-panel") !== null;
      });
      assert.equal(covered, true);
    } finally {
      await phone.close();
    }
  });
});

describe("the stop of a session, in a browser", () => {
  /** What the bar of the session holds about its stop. */
  const controlOf = (page: Page): Locator => page.locator("#session-stop");

  it("opens a confirmation a finger can press, on the way out, which closes without stopping anything and gives the focus back", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(390, SESSION, instance.api);
    try {
      await controlOf(page).click();
      const confirmation = page.getByRole("region", { name: "Arrêter cette session ?" });
      await confirmation.waitFor();
      assert.equal(await focusedOf(page), "A: Annuler");
      assert.deepEqual([await overflowOf(page), await tooSmallOf(page)], [0, []]);
      assert.equal(await page.evaluate(() => window.location.hash.endsWith("?stop=ask")), true);
      await page.keyboard.press("Enter");
      await confirmation.waitFor({ state: "detached" });
      assert.equal(await focusedOf(page), "A:  Arrêter");
      assert.deepEqual(instance.interrupted, []);
      await page.goBack();
      await confirmation.waitFor();
      await page.goForward();
      await confirmation.waitFor({ state: "detached" });
    } finally {
      await page.close();
    }
  });

  it("asks the instance once the person confirmed, says the stop was asked while the session still runs, then shows it interrupted", async () => {
    const instance = new PlayedInstance();
    let release = (): void => {};
    instance.hold = new Promise((resolve) => (release = resolve));
    const page = await app().open(1280, `${SESSION}?show=talk&stop=ask`, instance.api);
    try {
      const stop = page.getByRole("button", { name: "Arrêter la session" });
      await stop.click();
      await page.locator(".session-stop .btn.danger:disabled").waitFor();
      assert.deepEqual(instance.interrupted, []);
      release();
      await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
      assert.deepEqual(instance.interrupted, [SESSION_ID]);
      assert.equal(await page.evaluate(() => window.location.hash), `${SESSION}?show=talk`);
      assert.equal(await focusedOf(page), "SPAN: arrêt demandé…");
      assert.equal(await page.locator(".session-stop").count(), 0);
      assert.equal(await page.locator(".session-bar .badge").innerText(), "en direct");
      instance.obey();
      await page.locator(".session-bar .badge", { hasText: "interrompue" }).waitFor();
      await controlOf(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Poursuivre la session" }).waitFor();
    } finally {
      await page.close();
    }
  });

  it("says why the instance refused under the confirmation, which stays open to ask again", async () => {
    const instance = new PlayedInstance();
    instance.deaf = true;
    const page = await app().open(390, `${SESSION}?stop=ask`, instance.api);
    try {
      const stop = page.getByRole("button", { name: "Arrêter la session" });
      await stop.click();
      const alert = page.locator(".session-stop").getByRole("alert");
      await alert.waitFor();
      assert.equal(
        await alert.innerText(),
        "La session vient de se terminer : il n’y a plus rien à arrêter, et votre message, envoyé de nouveau, la poursuit.",
      );
      assert.deepEqual([await stop.isDisabled(), await overflowOf(page)], [false, 0]);
      instance.deaf = false;
      await stop.click();
      await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
      assert.equal(await alert.count(), 0);
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
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
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
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
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

  it("speaks the language of the configuration in force, which the page declares, and holds a phone in English as in French", async () => {
    const instance = new PlayedInstance();
    instance.language = "en";
    const page = await app().open(360, "#/agent", instance.api);
    try {
      await page.getByRole("heading", { name: "What do we test?" }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      assert.equal(await overflowOf(page), 0, "the entry in English");
      await page.goto(`http://console.test/${SESSION}`);
      await page.getByRole("button", { name: "Replay" }).waitFor();
      assert.equal(await overflowOf(page), 0, "a session in English");
      await page.goto(`http://console.test/${LOOKED}`);
      await page.getByRole("dialog", { name: /^Page looked at/ }).waitFor();
      assert.equal(await overflowOf(page), 0, "a look in English");
    } finally {
      await page.close();
    }
    const french = await app().open(360, "#/agent", new PlayedInstance().api);
    try {
      await french.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
      assert.equal(await french.evaluate(() => document.documentElement.lang), "fr");
    } finally {
      await french.close();
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

  it("opens the session a person asks for, and goes to its thread, where it waits in the queue", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("  vérifier le changement d'adresse  ");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await page.getByRole("heading", { level: 1, name: "vérifier le changement d'adresse" }).waitFor();
      assert.equal(new URL(page.url()).hash, `#/agent/sessions/${OPENED_ID}`);
      assert.deepEqual(instance.asked, [{ environment: "local", request: "vérifier le changement d'adresse" }]);
      await page.locator(".thread .request", { hasText: "vérifier le changement d'adresse" }).waitFor();
      assert.equal(await page.locator(".session-bar .badge").innerText(), "en file");
      assert.equal(await page.getByRole("status").filter({ hasText: "travaille" }).count(), 0);
      assert.equal(await page.getByRole("textbox", { name: "Dites aux agents ce qu’il faut corriger" }).isEnabled(), true);
    } finally {
      await page.close();
    }
  });

  it("takes a message for a queued session, goes on with its thread once it started, and closes it when it completes", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(1280, "#/agent", instance.api);
    try {
      const field = page.getByRole("textbox", { name: "Dites aux agents ce qu’il faut corriger" });
      const state = page.locator(".session-bar .badge");
      const working = page.getByRole("status").filter({ hasText: "Planificateur travaille" });
      await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("vérifier le changement d'adresse");
      await page.getByRole("button", { name: "Démarrer une session" }).click();
      await field.fill("sans le profil");
      await field.press("Enter");
      await page.locator(".sent", { hasText: "sans le profil" }).getByText("en attente d’un agent").waitFor();
      assert.deepEqual(instance.said, [{ text: "sans le profil" }]);
      assert.equal(await state.innerText(), "en file");
      instance.take();
      await working.waitFor();
      await state.filter({ hasText: "en direct" }).waitFor();
      assert.equal(await page.locator(".thread .request").count(), 2, "what was said while it waited stays in the thread");
      assert.equal(await field.isEnabled(), true);
      instance.completeOpened();
      await page.getByText("Verdict de l’exécution : 1 test").waitFor();
      await state.filter({ hasText: "tests réussis" }).waitFor();
      await field.waitFor({ state: "detached" });
      assert.equal(await working.count(), 0);
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
      const row = page.getByRole("link", { name: /vérifier le changement d'adresse/ });
      await row.waitFor();
      assert.match(await row.innerText(), /en attente d’un agent\s+en file$/);
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

describe("the configuration in a browser", () => {
  /** The configuration of the instance, its form read. */
  async function configurationAt(width: number, instance = new ConfiguredInstance()): Promise<Page> {
    const page = await app().open(width, "#/configuration", instance.api);
    await page.getByRole("heading", { name: "Applications et environnements" }).waitFor();
    return page;
  }

  /** What a finger would miss among the fields of the form and the boxes it checks, besides the links and the buttons. */
  function tooSmallFieldsOf(page: Page): Promise<string[]> {
    return page.evaluate(
      (least) =>
        [...document.querySelectorAll(".config-field input, .config-field select, .check")]
          .map((element) => ({ element, box: element.getBoundingClientRect() }))
          .filter(({ box }) => Math.round(box.height * 100) < least * 100)
          .map(({ element, box }) => `${element.tagName} ${element.getAttribute("name") ?? element.textContent} ${box.height}`),
      TAP,
    );
  }

  it("fits a phone and a wide screen, every field and button a finger can press, what is typed at 16 px at least", async () => {
    for (const width of [390, 1440]) {
      const page = await configurationAt(width);
      try {
        await page.locator("details.config-json summary").click();
        assert.equal(await overflowOf(page), 0, `${width}`);
        if (width < 1100) {
          // Every entry of the bar stands whole in the window, its icon named by its label.
          for (const name of ["Agent", "Configuration"]) {
            const box = await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name }).boundingBox();
            assert.ok(box !== null && box.x >= 0 && box.x + box.width <= width, `${name} at ${width}`);
          }
          const save = await page.getByRole("button", { name: "Enregistrer" }).evaluate((button) => getComputedStyle(button).opacity);
          assert.equal(save, "1", "a disabled button of the head keeps its text legible");
          assert.deepEqual(await tooSmallOf(page), [], `${width}`);
          assert.deepEqual(await tooSmallFieldsOf(page), [], `${width}`);
          const size = await page.getByLabel("Modèle", { exact: true }).evaluate((field) => parseFloat(getComputedStyle(field).fontSize));
          assert.ok(size >= 16, `${size} px`);
        }
      } finally {
        await page.close();
      }
    }
  });

  it("shows beside its field the error the instance finds as the person types, then saves the change, which the history lists", async () => {
    const instance = new ConfiguredInstance();
    const page = await configurationAt(1440, instance);
    try {
      const model = page.getByLabel("Modèle", { exact: true });
      await model.fill("");
      await page.locator("#config-model-model-errors").filter({ hasText: "Ce champ ne peut pas être vide." }).waitFor();
      assert.equal(await model.getAttribute("aria-invalid"), "true");
      await page.getByText("1 erreur à corriger avant d’enregistrer").waitFor();
      await model.fill("other-model");
      await page.getByText("1 erreur à corriger").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await page.getByRole("status").filter({ hasText: "Révision 3 enregistrée" }).waitFor();
      await page.getByText("Révision 3", { exact: true }).waitFor();
      assert.equal(instance.saved[0]!.document.model.model, "other-model");
      assert.equal(await page.getByRole("button", { name: "Enregistrer" }).isDisabled(), true);
    } finally {
      await page.close();
    }
  });

  it("refuses a change while the file changed too, and leaves the person the two ways out, each one press", async () => {
    const instance = new ConfiguredInstance();
    instance.fileChanged = true;
    const page = await configurationAt(390, instance);
    try {
      await page.getByText("oqas.json a changé depuis la révision en vigueur").waitFor();
      await page.getByLabel("Modèle", { exact: true }).fill("kept-model");
      await page.getByRole("button", { name: "Enregistrer" }).click();
      const conflict = page.getByRole("alert").filter({ hasText: "oqas.json a changé depuis la dernière synchronisation" });
      await conflict.waitFor();
      assert.deepEqual(await tooSmallOf(page), []);
      await conflict.getByRole("button", { name: "Garder mes modifications" }).click();
      await page.getByRole("status").filter({ hasText: "Révision 3 enregistrée" }).waitFor();
      assert.equal(instance.saved[0]!.replaceFile, true);
      instance.fileChanged = true;
      await page.getByRole("button", { name: "Prendre oqas.json" }).click();
      await page.getByRole("status").filter({ hasText: "Révision 4 enregistrée" }).waitFor();
      assert.equal(instance.revisions[0]!.origin, "file");
    } finally {
      await page.close();
    }
  });
});

describe("the knowledge in a browser", () => {
  /** The documents of the source the instance keeps, listed. */
  async function documentsAt(width: number, instance = new DocumentedInstance(), hash = "#/knowledge/manuals"): Promise<Page> {
    const page = await app().open(width, hash, instance.api);
    await page.getByRole("heading", { name: "manuals" }).waitFor();
    await page.getByRole("link", { name: "quotes.md", exact: true }).waitFor();
    return page;
  }

  it("fits a phone and a wide screen, the sources, the documents, a removal asked and a document read, every link and button a finger can press", async () => {
    for (const width of [390, 1440]) {
      const page = await app().open(width, "#/knowledge", new DocumentedInstance().api);
      try {
        await page.getByText("manuals").first().waitFor();
        await page.getByText("1 document", { exact: true }).waitFor();
        assert.equal(await overflowOf(page), 0, `overview at ${width}`);
        if (width < 1100) assert.deepEqual(await tooSmallOf(page), [], `overview at ${width}`);
        await page.goto(`http://console.test/#/knowledge/manuals?remove=quotes.md&document=quotes.md`);
        await page.getByRole("button", { name: "Retirer le document" }).waitFor();
        await page.getByText("A quote is priced.").waitFor();
        assert.equal(await overflowOf(page), 0, `source at ${width}`);
        if (width < 1100) assert.deepEqual(await tooSmallOf(page), [], `source at ${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("uploads the files chosen, which the list then shows, and refuses beside the field a file it does not read", async () => {
    const instance = new DocumentedInstance();
    const page = await documentsAt(390, instance);
    try {
      const field = page.getByLabel("Fichiers Markdown");
      await field.setInputFiles([
        { name: "claims.md", mimeType: "text/markdown", buffer: Buffer.from("# Claims\n") },
        { name: "manual.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") },
      ]);
      await page.getByRole("button", { name: "Déposer", exact: true }).click();
      const refused = page.getByRole("alert").filter({ hasText: "manual.pdf Seul le Markdown est lu" });
      await refused.waitFor();
      assert.equal(await field.getAttribute("aria-invalid"), "true");
      assert.equal(instance.documents.size, 1);
      await field.setInputFiles([{ name: "claims.md", mimeType: "text/markdown", buffer: Buffer.from("# Claims\n") }]);
      await page.getByRole("button", { name: "Déposer", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "1 document déposé" }).waitFor();
      await page.getByRole("link", { name: "claims.md", exact: true }).waitFor();
      assert.equal(await field.evaluate((input: HTMLInputElement) => input.files?.length), 0);
      assert.equal(instance.documents.get("claims.md")?.text, "# Claims\n");
    } finally {
      await page.close();
    }
  });

  it("removes a document once the person confirmed it, and closes the confirmation", async () => {
    const instance = new DocumentedInstance();
    const page = await documentsAt(1440, instance);
    try {
      await page.getByRole("link", { name: "Retirer quotes.md" }).click();
      await page.getByRole("button", { name: "Retirer le document" }).click();
      await page.getByRole("status").filter({ hasText: "Document retiré." }).waitFor();
      await page.getByText("Aucun document pour l’instant").waitFor();
      assert.equal(new URL(page.url()).hash, "#/knowledge/manuals");
      assert.equal(instance.documents.size, 0);
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
          .getByRole("link", { name: /voir la page consultée/ })
          .first()
          .click();
        await page.locator(".act.selected").waitFor();
        await page.getByRole("dialog", { name: /^Page consultée/ }).waitFor();
        await page.keyboard.press("Tab");
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Lire la suite" }).click();
        await page.getByRole("button", { name: "Replier", exact: true }).waitFor();
        await page.getByRole("button", { name: "Rejouer" }).click();
        await page.getByRole("button", { name: "Pause" }).waitFor();
        await page.waitForFunction(() => Number(document.querySelector(".playback-progress")?.getAttribute("aria-valuenow")) > 0);
        await page.getByRole("button", { name: "Changer la vitesse" }).click();
        await page.getByRole("button", { name: "Pause" }).click();
        await page.getByRole("button", { name: "Reprendre" }).waitFor();
        await page.getByRole("button", { name: "Aller au prochain verdict" }).click();
        await page.getByText("Plan accepté par le harnais").waitFor();
        await page.getByRole("button", { name: "Revenir au direct" }).click();
        await page.getByRole("button", { name: "Rejouer" }).waitFor();
        const field = page.getByRole("textbox", { name: "Dites aux agents ce qu’il faut corriger" });
        await field.fill("   ");
        await field.press("Enter");
        instance.deaf = true;
        await field.fill("sans le profil");
        await field.press("Shift+Enter");
        await field.press("Enter");
        await page.getByText("La session vient de se terminer").waitFor();
        instance.deaf = false;
        await page.getByRole("button", { name: "Envoyer" }).click();
        await page.locator(".sent", { hasText: "sans le profil" }).waitFor();
        await page.getByRole("link", { name: "Arrêter" }).click();
        await page.getByRole("button", { name: "Arrêter la session" }).click();
        await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
        instance.obey();
        await page.getByRole("textbox", { name: "Dites aux agents quoi faire ensuite : corriger un test, ajouter un scénario…" }).fill("corriger le test");
        await page.getByRole("button", { name: "Poursuivre la session" }).click();
        await page.getByRole("button", { name: "Envoyer" }).waitFor();
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
        await page.getByText("La session est de nouveau en cours").waitFor();
        instance.refusal = undefined;
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.getByRole("heading", { level: 1, name: "vérifier le changement d'adresse" }).waitFor();
        // The menu folds as the person asks, and stays so at the next visit; a trace opens with it folded, whatever is kept.
        await page.getByRole("button", { name: "Replier le menu" }).click();
        assert.equal(await page.evaluate(() => window.localStorage.getItem("oqas.navigation")), "folded");
        await page.getByRole("button", { name: "Déplier le menu" }).click();
        await page.goto("http://console.test/#/executions/trace?id=e1&path=a.spec.ts");
        await page.getByRole("button", { name: "Déplier le menu" }).click();
        await page.getByRole("button", { name: "Replier le menu" }).waitFor();
        await page.goto("http://console.test/#/agent");
        await page.getByRole("button", { name: "Replier le menu" }).waitFor();
      },
      instance.api,
    );
    assert.ok(main!.lines.includes(mount), `line ${mount} of src/main.tsx, the mount, is in the build`);
    assert.deepEqual(main!.uncovered, []);
    assert.ok(application!.lines.length > 20, "the application is in the build");
    assert.deepEqual(application!.uncovered, []);
  });

  it("runs every line of the scope of a session when it is chosen in the browser, and opens the session kept to it", async () => {
    const instance = new PlayedInstance();
    const domains = [
      { id: "quotes", label: "Devis", description: "Les demandes de devis." },
      { id: "policies", label: "Polices", description: "Les contrats." },
      { id: "customers", label: "Clients", description: "Les clients." },
    ];
    const [entry, picker] = await app().measure(
      ["src/agent/agent-home-page.tsx", "src/agent/scope-picker.tsx"],
      async (page) => {
        // Before a cartography, no domain is named; one environment goes with the request as it is.
        await page.goto("http://console.test/#/agent");
        await page.getByText("Domaines : pas encore cartographiés").waitFor();
        await page.getByText("Environnement : local").waitFor();
        instance.domains = domains;
        instance.staging = true;
        await page.goto("http://console.test/#/tests");
        await page.goto("http://console.test/#/agent");
        await page.getByLabel("Environnement :").selectOption("staging");
        await page.getByText("Domaines : tous").click();
        for (const label of ["Devis", "Polices", "Clients"]) await page.getByRole("checkbox", { name: new RegExp(`^${label}`) }).check();
        await page.getByText("Domaines : 3 choisis").waitFor();
        await page.getByRole("checkbox", { name: /^Clients/ }).uncheck();
        await page.getByText("Domaines : Devis, Polices").waitFor();
        await page.getByRole("button", { name: "tous" }).first().click();
        await page.getByText("Domaines : tous").waitFor();
        await page.getByRole("checkbox", { name: /^Devis/ }).check();
        await page.getByText("Niveaux : tous").click();
        await page.getByRole("checkbox", { name: "métier" }).check();
        await page.getByRole("textbox", { name: "Dites aux agents quoi tester" }).fill("couvrir les devis");
        await page.getByRole("button", { name: "Démarrer une session" }).click();
        await page.waitForURL(/#\/agent\/sessions\//);
        // Without a configuration, the request goes alone.
        instance.unconfigured = true;
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        await page.waitForTimeout(200);
        assert.equal(await page.locator(".scope-picker").count(), 0);
      },
      instance.api,
    );
    assert.deepEqual(instance.asked.at(-1), { request: "couvrir les devis", environment: "staging", scope: { domains: ["quotes"], levels: ["business"] } });
    assert.ok(entry!.lines.length > 0 && picker!.lines.length > 0, "the entry and the picker are in the build");
    assert.deepEqual([entry!.uncovered, picker!.uncovered], [[], []]);
  });

  it("lets the screen of the tests, its long paths and its filter, fit the width of a small phone", async () => {
    const page = await app().open(360, "#/tests", new ListedInstance().api);
    try {
      await page.locator(".tests-row").first().waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("runs every line of the card of a test when it is used in the browser, from the list of the tests, and leads to its latest result", async () => {
    const instance = new ListedInstance();
    const [screen] = await app().measure(
      ["src/tests/test-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/tests");
        await page.getByRole("link", { name: /Display the detail of a policy/ }).click();
        await page.waitForURL(/#\/tests\/view\?path=apps%2Fpolicy-management%2F/);
        await page.getByText("1. Open the policy of the customer").waitFor();
        instance.refusal = "launch_refused";
        await page.getByRole("button", { name: "Relancer ce test" }).click();
        await page.getByText("Les tests ne peuvent pas être lancés maintenant").waitFor();
        await page.getByRole("button", { name: "Relancer ce test" }).click();
        await page.getByText("Relance en cours").waitFor();
        instance.launches = { last: { ...instance.launches.running!, endedAt: "2026-11-20T10:02:00.000Z", execution: "e1" } };
        await page.getByRole("button", { name: "Relancer ce test" }).and(page.locator(":enabled")).waitFor();
        // Without a configuration, the test runs again in the environment of the project.
        instance.unconfigured = true;
        await page.goto("http://console.test/#/tests");
        await page.goBack();
        await page.getByRole("button", { name: "Relancer ce test" }).waitFor();
        instance.unconfigured = false;
        await page.getByRole("link", { name: /Voir le dernier résultat/ }).click();
        await page.waitForURL(/#\/executions\/result\?id=/);
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 0, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the screen of a trace when it is used in the browser, from the result of a test, the menu folded", async () => {
    const [screen] = await app().measure(
      ["src/executions/trace-page.tsx"],
      async (page) => {
        await page.goto(`http://console.test/#/executions/result?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`);
        await page.getByRole("link", { name: /Voir la trace/ }).click();
        await page.waitForURL(/#\/executions\/trace\?id=/);
        await page.locator("iframe.trace-frame").waitFor();
        await page.locator(".shell.folded").waitFor();
      },
      new ListedInstance().api,
    );
    assert.ok(screen!.lines.length > 0, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the pages of the campaigns when they are used in the browser: plan one, fix its tests, launch them, close it", async () => {
    const instance = new ListedInstance();
    const [list, one] = await app().measure(
      ["src/campaigns/campaigns-page.tsx", "src/campaigns/campaign-page.tsx"],
      async (page) => {
        // The console speaks the language of the configuration it read first; the page of the campaigns then reads none.
        await page.goto("http://console.test/#/agent");
        await page.getByRole("heading", { name: "Qu’est-ce qu’on teste ?" }).waitFor();
        instance.unconfigured = true;
        await page.evaluate(() => (window.location.hash = "#/campaigns"));
        await page.getByRole("link", { name: /Recette 4\.2/ }).waitFor();
        await page.getByRole("textbox", { name: "Nom" }).fill("Recette 4.3");
        await page.getByRole("textbox", { name: "Environnement" }).fill("local");
        await page.getByRole("textbox", { name: "Tags des tests" }).fill("p0, @p1");
        instance.refusal = "invalid_request";
        await page.getByRole("button", { name: "Planifier" }).click();
        await page.getByRole("alert").waitFor();
        await page.getByRole("button", { name: "Planifier" }).click();
        await page.waitForURL(/#\/campaigns\/view\?id=c2/);
        await page.getByRole("button", { name: "Figer les tests" }).click();
        await page.getByRole("button", { name: "Lancer les tests" }).click();
        await page.getByText("Lancement en cours : 1 / 2 tests finis").waitFor();
        // The launch ends: the campaign is read again.
        instance.launches = { last: { ...instance.launches.running!, endedAt: "2026-11-20T10:02:00.000Z", execution: "e1" } };
        await page.getByRole("button", { name: "Clôturer", exact: true }).click();
        await page.getByRole("button", { name: "Annuler" }).click();
        await page.getByRole("button", { name: "Tout relancer" }).click();
        await page.getByText("Lancement en cours : 1 / 2 tests finis").waitFor();
        instance.launches = {};
        await page.getByRole("button", { name: "Clôturer", exact: true }).click();
        instance.refusal = "campaign_refused";
        await page.getByRole("button", { name: "Clôturer la campagne" }).click();
        await page.getByText("La campagne refuse ce changement").waitFor();
        await page.getByRole("button", { name: "Clôturer", exact: true }).click();
        await page.getByRole("button", { name: "Clôturer la campagne" }).click();
        await page.getByText("Clôturée le").waitFor();
        // Once the configuration is read again, the form offers the environments it declares.
        instance.unconfigured = false;
        await page.evaluate(() => (window.location.hash = "#/campaigns"));
        await page.locator('select[name="environment"]').waitFor();
      },
      instance.api,
    );
    assert.ok(list!.lines.length > 0 && one!.lines.length > 0, "the pages are in the build");
    assert.deepEqual([list!.uncovered, one!.uncovered], [[], []]);
  });

  it("lets the screens of the campaigns fit the width of a small phone", async () => {
    for (const hash of ["#/campaigns", "#/campaigns/view?id=c1"]) {
      const page = await app().open(360, hash, new ListedInstance().api);
      try {
        await page.locator(".campaign-row, .campaign-result").first().waitFor();
        assert.equal(await overflowOf(page), 0, hash);
      } finally {
        await page.close();
      }
    }
  });

  it("lets the screen of a trace fit the width of a small phone", async () => {
    const page = await app().open(360, `#/executions/trace?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`, new ListedInstance().api);
    try {
      await page.locator("iframe.trace-frame").waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("lets the card of a test, its tags, its steps, its versions and its executions, fit the width of a small phone", async () => {
    const instance = new ListedInstance();
    const since = "2026-11-19T10:00:05.000Z";
    instance.versions = [
      { path: DETAIL, title: "Policies › Display the detail of a policy with a long title", number: 12, digest: "d12", since, executions: 140 },
      {
        path: DETAIL,
        title: "Display the detail of a policy",
        number: 11,
        digest: "d11",
        commit: "4f2a9c01d3b6e8a7f5c2d1e0b9a8c7d6e5f4a3b2",
        since,
        executions: 3,
      },
    ];
    const page = await app().open(360, `#/tests/view?path=${encodeURIComponent(DETAIL)}`, instance.api);
    try {
      await page.locator(".test-written").waitFor();
      await page.getByText("Version 12").waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("runs every line of the screen of a result when it is used in the browser, and shows the page at the step chosen", async () => {
    const [screen] = await app().measure(
      ["src/executions/result-page.tsx"],
      async (page) => {
        await page.goto(`http://console.test/#/executions/result?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`);
        await page.getByText("Échoue à l’étape 2 sur 2.").waitFor();
        // A step chosen in the list shows its page, and the address keeps it.
        await page.getByRole("link", { name: /Open the policy of the customer/ }).click();
        await page.waitForURL(/&step=1$/);
        await page.getByRole("img", { name: "Capture de l’étape 1" }).waitFor({ state: "attached" });
      },
      new ListedInstance().api,
    );
    assert.ok(screen!.lines.length > 5, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("lets the screen of a result, its steps, its captures and its details, fit the width of a small phone", async () => {
    const page = await app().open(360, `#/executions/result?id=${EXECUTIONS[0]!.id}&path=${encodeURIComponent(DETAIL)}`, new ListedInstance().api);
    try {
      await page.locator(".test-step").first().waitFor();
      await page.getByText("Détails techniques").click();
      assert.equal(await overflowOf(page), 0);
      // The page at a step takes the whole width of the card.
      await page.goto(`${page.url()}&step=1`);
      const capture = await page.getByRole("img", { name: "Capture de l’étape 1" }).boundingBox();
      assert.ok(capture !== null && capture.width > 300, JSON.stringify(capture));
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("lets the executions, a line unfolded into its tests, and the screen of one, fit the width of a small phone", async () => {
    const page = await app().open(360, "#/executions", new ListedInstance().api);
    try {
      await page.locator(".exec-row summary").first().click();
      await page.locator(".exec-tests .tests-row").first().waitFor();
      assert.equal(await overflowOf(page), 0);
      await page.goto(`http://console.test/#/executions/view?id=${EXECUTIONS[0]!.id}`);
      await page.locator(".tests-row").first().waitFor();
      assert.equal(await overflowOf(page), 0);
    } finally {
      await page.close();
    }
  });

  it("shows the executions as a table on a wide screen, its heading on one line above the cells of each execution", async () => {
    const page = await app().open(1280, "#/executions", new ListedInstance().api);
    try {
      await page.locator(".exec-row summary").first().waitFor();
      // The cells of a line share a band: each starts above where every other ends.
      const boxes = async (line: string) =>
        Promise.all((await page.locator(`${line} > span, ${line} > a`).all()).map(async (cell) => (await cell.boundingBox())!));
      for (const line of [".exec-head", "details.exec-row:first-of-type > summary"]) {
        // The room of the toggle in the heading holds nothing, and has no height.
        const cells = (await boxes(line)).filter((cell) => cell.height > 0);
        assert.ok(
          cells.length >= 5 && Math.max(...cells.map((cell) => cell.y)) < Math.min(...cells.map((cell) => cell.y + cell.height)),
          `${line} ${JSON.stringify(cells)}`,
        );
      }
    } finally {
      await page.close();
    }
  });

  it("runs every line of the screens of the executions when they are used in the browser, from a page to an execution and to a result", async () => {
    const [list, one, polled] = await app().measure(
      ["src/executions/executions-page.tsx", "src/executions/execution-page.tsx", "src/api/use-polled.ts"],
      async (page) => {
        // An execution the instance does not keep is said so, in the words of the console.
        await page.goto("http://console.test/#/executions/view?id=gone");
        await page.getByText("L’instance ne garde plus cette exécution.").waitFor();
        await page.goto("http://console.test/#/executions");
        const outcome = page.getByLabel("Issue");
        const period = page.getByLabel("Période");
        await outcome.selectOption("failing");
        await page.waitForURL(/#\/executions\?outcome=failing$/);
        await period.selectOption("week");
        await page.waitForURL(/#\/executions\?outcome=failing&period=week$/);
        await page.getByRole("link", { name: /Plus anciennes/ }).click();
        await page.waitForURL(/#\/executions\?outcome=failing&period=week&before=older$/);
        await page.getByRole("link", { name: /Les plus récentes/ }).waitFor();
        // Choosing a filter opens its first page; the first choice of a list keeps every execution.
        await outcome.selectOption("");
        await page.waitForURL(/#\/executions\?period=week$/);
        await period.selectOption("");
        await page.waitForURL(/#\/executions$/);
        await page.locator(".exec-row summary").first().click();
        await page
          .getByRole("link", { name: /Ouvrir l’exécution/ })
          .first()
          .click();
        await page.waitForURL(/#\/executions\/view\?id=/);
        await page.getByRole("link", { name: /Policies › Edit a policy/ }).click();
        await page.waitForURL(/#\/executions\/result\?id=/);
      },
      new ListedInstance().api,
    );
    for (const measured of [list, one, polled]) {
      assert.ok(measured!.lines.length > 0, "the module is in the build");
      assert.deepEqual(measured!.uncovered, []);
    }
  });

  it("runs every line of the screen of the tests when it is used in the browser", async () => {
    const instance = new ListedInstance();
    const [screen] = await app().measure(
      ["src/tests/tests-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/tests?level=functional");
        await page.getByText("Display the detail of a policy").waitFor();
        await page.getByRole("searchbox", { name: "Chercher un titre, un chemin ou un tag" }).fill("  edit  ");
        await page.getByRole("searchbox", { name: "Chercher un titre, un chemin ou un tag" }).press("Enter");
        await page.waitForURL(/#\/tests\?level=functional&q=edit$/);
        // The search narrows the list: the test it does not match goes, the one it matches stays.
        await page.getByText("Display the detail of a policy").waitFor({ state: "detached" });
        await page.getByText("Compare the edit form of a policy").waitFor();
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the screens of the knowledge when they are used in the browser", async () => {
    const instance = new DocumentedInstance();
    const [screen] = await app().measure(
      ["src/knowledge/knowledge-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/knowledge/manuals?document=quotes.md");
        await page.getByText("A quote is priced.").waitFor();
        await page.getByLabel("Fichiers Markdown").setInputFiles([{ name: "claims.md", mimeType: "text/markdown", buffer: Buffer.from("# Claims\n") }]);
        await page.getByRole("button", { name: "Déposer", exact: true }).click();
        await page.getByRole("status").filter({ hasText: "1 document déposé" }).waitFor();
        await page.getByRole("link", { name: "Retirer claims.md" }).click();
        await page.getByRole("button", { name: "Retirer le document" }).click();
        await page.getByRole("status").filter({ hasText: "Document retiré." }).waitFor();
        await page.waitForURL(/#\/knowledge\/manuals$/);
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });

  it("runs every line of the screen of the configuration when it is used in the browser", async () => {
    const instance = new ConfiguredInstance();
    const [screen] = await app().measure(
      ["src/configuration/configuration-page.tsx"],
      async (page) => {
        await page.goto("http://console.test/#/configuration");
        await page.getByRole("heading", { name: "Applications et environnements" }).waitFor();
        await page.getByLabel("Nom", { exact: true }).first().fill("Boutique");
        await page.getByLabel("Attente d’une réponse, en secondes").fill("90");
        await page.getByLabel("Ce qu’elle expose").selectOption("web");
        await page.getByLabel("Niveau", { exact: true }).selectOption("autonomous");
        await page.getByLabel("Inter-applications").check();
        await page.getByRole("button", { name: "Ajouter un environnement" }).click();
        await page.getByRole("button", { name: "Retirer l’environnement 2 de Boutique" }).click();
        await page.getByRole("button", { name: "Annuler les modifications" }).click();
        await page.getByRole("button", { name: "Enregistrer" }).waitFor({ state: "attached" });
        await page.getByLabel("Modèle", { exact: true }).fill("saved-model");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 3 enregistrée" }).waitFor();
        instance.fileChanged = true;
        await page.getByLabel("Modèle", { exact: true }).fill("kept-model");
        await page.getByRole("button", { name: "Enregistrer" }).click();
        await page.getByRole("button", { name: "Garder mes modifications" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 4 enregistrée" }).waitFor();
        instance.fileChanged = true;
        await page.getByRole("button", { name: "Prendre oqas.json" }).click();
        await page.getByRole("status").filter({ hasText: "Révision 5 enregistrée" }).waitFor();
      },
      instance.api,
    );
    assert.ok(screen!.lines.length > 10, "the screen is in the build");
    assert.deepEqual(screen!.uncovered, []);
  });
});
