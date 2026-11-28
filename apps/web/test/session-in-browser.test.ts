import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Locator, Page } from "playwright-core";
import { SESSION_ID } from "./agent/session-fixture.ts";
import { ACTIONS, builtConsole, focusedOf, LOOKED, overflowOf, SESSION, settled, tooSmallOf } from "./in-browser.ts";
import { PlayedInstance } from "./played-instance.ts";
import { ListedInstance } from "./tests/listed-instance.ts";

const app = builtConsole();

describe("the shell on a narrow and on a wide screen", () => {
  it("names the project at the top of a phone, keeps its tabs at the bottom, each whole and in reach of a finger, and lists the other entries behind the last", async () => {
    const page = await app().open(390, "#/tests", new ListedInstance().api);
    try {
      await page.getByRole("heading", { level: 1, name: "Tests" }).waitFor();
      const bar = await page.locator(".top").boundingBox();
      assert.ok(bar !== null);
      assert.deepEqual([bar.x, bar.y, bar.width], [0, 0, 390]);
      assert.equal(await page.locator(".shell-sidebar").isVisible(), false, "a phone has its tabs, not the menu");
      const tabs = page.getByRole("navigation", { name: "Onglets" });
      const docked = await tabs.boundingBox();
      assert.ok(docked !== null);
      assert.deepEqual([docked.x, docked.y + docked.height, docked.width], [0, 800, 390], "the tabs stay at the bottom of the screen");
      const named = await tabs.getByRole("link").evaluateAll((all) =>
        all.map((link) => {
          const label = link.querySelector(".tab-label")!;
          return { text: label.textContent, cut: label.scrollWidth > label.clientWidth, height: link.getBoundingClientRect().height };
        }),
      );
      assert.deepEqual(
        named.map(({ text }) => text),
        ["Agent", "À relire", "Tests", "Exécutions", "Plus"],
      );
      for (const tab of named) assert.ok(!tab.cut && tab.height >= 44, `${tab.text} stands whole, ${tab.height} px high`);
      assert.equal(await tabs.getByRole("link", { name: "Tests" }).getAttribute("aria-current"), "page");
      assert.equal(await overflowOf(page), 0);
      assert.deepEqual(await tooSmallOf(page), []);
      await tabs.getByRole("link", { name: "Plus" }).click();
      await page.getByRole("heading", { level: 1, name: "Plus" }).waitFor();
      assert.equal(new URL(page.url()).hash, "#/more");
      assert.equal(await tabs.getByRole("link", { name: "Plus" }).getAttribute("aria-current"), "page");
      assert.deepEqual(await tooSmallOf(page), []);
      await page.getByRole("link", { name: "Campagnes" }).click();
      await page.getByRole("heading", { level: 1, name: "Campagnes" }).waitFor();
      assert.equal(await tabs.getByRole("link", { name: "Plus" }).getAttribute("aria-current"), "page", "an entry behind the last tab marks it");
    } finally {
      await page.close();
    }
  });

  it("leads back on a phone to the screen a page is under, where a wider screen shows the breadcrumb", async () => {
    for (const [width, back, crumb] of [
      [390, true, false],
      [720, false, true],
    ] as const) {
      const page = await app().open(width, "#/executions/view?id=e1", new ListedInstance().api);
      try {
        // What the width shows is waited for, then what it hides is looked at, once the page is laid out.
        const way = page.getByRole("link", { name: "Retour à Exécutions" });
        await (back ? way : page.locator(".crumb")).waitFor({ state: "visible" });
        assert.equal(await way.isVisible(), back, `the way back at ${width}`);
        assert.equal(await page.locator(".crumb").isVisible(), crumb, `the breadcrumb at ${width}`);
      } finally {
        await page.close();
      }
    }
    const page = await app().open(390, "#/executions/view?id=e1", new ListedInstance().api);
    try {
      await page.getByRole("link", { name: "Retour à Exécutions" }).click();
      await page.getByRole("heading", { level: 1, name: "Exécutions" }).waitFor();
      assert.equal(await page.getByRole("link", { name: /^Retour à / }).count(), 0, "a screen of the tabs leads back to none");
    } finally {
      await page.close();
    }
  });

  it("shows the menu at the left of the page, the whole height of the window, from a tablet, without the bar or the tabs of a phone", async () => {
    for (const width of [720, 1099, 1440]) {
      const page = await app().open(width, "", new PlayedInstance().api);
      try {
        await page.getByText("1 application · projet").waitFor();
        assert.deepEqual(await page.locator(".shell-sidebar").boundingBox(), { x: 0, y: 0, width: 248, height: 800 }, `${width}`);
        assert.equal(await page.locator(".top").isVisible(), false, `${width}`);
        assert.equal(await page.getByRole("navigation", { name: "Onglets" }).isVisible(), false, `${width}`);
        assert.ok(await page.getByRole("link", { name: "Raccourcis clavier" }).isVisible(), `${width}`);
        assert.equal(await overflowOf(page), 0, `${width}`);
      } finally {
        await page.close();
      }
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
        [`${SESSION}?verdicts=off&agent=planner`, ".followed-chip"],
        ["#/agent/sessions/oqas-gone", ".state"],
        ["#/nowhere", ".state"],
      ] as const) {
        await page.goto(`http://console.test/${hash}`);
        await page.locator(shown).first().waitFor();
        const overflow = await overflowOf(page);
        if (overflow > 0) overflowing.push(`${hash} by ${overflow} px`);
      }
      instance.complete();
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

  it("keeps what a row says first at a reading width on a phone, its facts under it, with no hole between", async () => {
    const page = await app().open(390, "#/agent", new PlayedInstance().api);
    try {
      const row = page.locator(".run-row").first();
      await row.waitFor();
      const sizes = await row.evaluate((element) => ({
        row: element.getBoundingClientRect().height,
        parts: [...element.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0),
        title: element.querySelector(".grow")!.getBoundingClientRect().width,
      }));
      assert.ok(sizes.title >= 250, `the title is ${sizes.title} px wide`);
      assert.ok(sizes.row <= sizes.parts + 48, `the row is ${sizes.row} px high for ${sizes.parts} px of content`);
    } finally {
      await page.close();
    }
  });

  it("gives a finger 44 px at least on all that is pressed on the entry and on a session, on a phone", async () => {
    const instance = new PlayedInstance();
    const page = await app().open(390, "#/agent", instance.api);
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
      instance.complete();
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
        const edges = await page.locator(".summary, .conversation-head, .composer").evaluateAll((all) => all.map((one) => one.getBoundingClientRect().x));
        assert.deepEqual(edges, [title.x, title.x, title.x], `${width}: one left edge`);
        assert.equal(thread.x, title.x, `${width}: the thread starts where the title does`);
        assert.equal(await overflowOf(page), 0, `${width}`);
      } finally {
        await page.close();
      }
    }
  });

  it("opens from the eye of an action, on that action, named after it, and takes the focus", async () => {
    const page = await app().open(1440, ACTIONS, new PlayedInstance().api);
    try {
      await page.getByText("I write the test now.").waitFor();
      await page.getByText("2 actions", { exact: true }).click();
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
      const page = await app().open(width, ACTIONS, new PlayedInstance().api);
      const closings: readonly (readonly [string, () => Promise<unknown>])[] = [
        ["its link", () => page.getByRole("dialog").getByRole("link", { name: "Fermer" }).click()],
        ["Escape", () => page.keyboard.press("Escape")],
        ["the way back", () => page.goBack()],
      ];
      try {
        await page.setViewportSize({ width, height: 420 });
        await page.getByText("I write the test now.").waitFor();
        await page.getByText("2 actions", { exact: true }).click();
        const eye = page.getByRole("link", { name: /voir la page consultée/ });
        for (const [name, close] of closings) {
          await eye.click();
          await page.getByRole("dialog").waitFor();
          await close();
          await page.getByRole("dialog").waitFor({ state: "detached" });
          assert.equal(new URL(page.url()).hash, ACTIONS, `${width}, ${name}`);
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
      const page = await app().open(width, ACTIONS, new PlayedInstance().api);
      try {
        await page.setViewportSize({ width, height: 420 });
        await page.getByText("I write the test now.").waitFor();
        await page.getByText("2 actions", { exact: true }).click();
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
      const page = await app().open(width, ACTIONS, new PlayedInstance().api);
      try {
        await page.getByText("I write the test now.").waitFor();
        // A phase sets its turns in by its padding: they start and end where its content does.
        const phase = await page.locator(".phase.current .phase-turns").evaluate((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { x: box.left + parseFloat(style.paddingLeft), right: box.right - parseFloat(style.paddingRight) };
        });
        const lefts = (selector: string): Promise<number[]> =>
          page
            .locator(selector)
            .evaluateAll((all) => [...new Set(all.filter((one) => one.getClientRects().length > 0).map((one) => one.getBoundingClientRect().left))]);
        assert.deepEqual(
          await lefts(".turn-body > :not(.turn-head), .brief .speaker-mark, .verdict, .result-card, .pass.minor .pass-title"),
          [phase.x + keyline],
          `${width}: one keyline`,
        );
        assert.deepEqual(
          await lefts(".brief summary > span:not([class]), .note-text"),
          [phase.x + keyline + 28],
          `${width}: the harness speaks from one edge, after the room of its mark`,
        );
        assert.deepEqual(await lefts(".act-line, .thinking svg, .lead"), [phase.x + keyline + 16], `${width}: what a surface holds is set in by one padding`);
        const ends = await page
          .locator(".turn-head .turn-at, .brief .turn-at, .verdict .turn-at, .result-card .turn-at, .act-time")
          .evaluateAll((all) => [...new Set(all.filter((one) => one.getClientRects().length > 0).map((one) => one.getBoundingClientRect().right))]);
        assert.deepEqual(ends, [phase.right - 16], `${width}: one right edge for the times`);
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
        await page.locator(".refusals > summary").click();
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

  it("sets the facts of the summary two by two on a phone, and on one line from a tablet", async () => {
    for (const [width, rows] of [
      [360, 2],
      [720, 1],
    ] as const) {
      const page = await app().open(width, SESSION, new PlayedInstance().api);
      try {
        await page.getByText("I write the test now.").waitFor();
        const tops = await page.locator(".summary-fact").evaluateAll((all) => all.map((fact) => fact.getBoundingClientRect().top));
        assert.equal(tops.length, 3);
        assert.equal(new Set(tops).size, rows, `${width}`);
        assert.equal(await overflowOf(page), 0, `${width}`);
      } finally {
        await page.close();
      }
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
  const fieldOf = (page: Page): Locator => page.getByRole("textbox", { name: "Écrivez aux agents : préciser, corriger, ajouter un scénario" });

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
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), "Session du 15 nov., 14:44 En direct");
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
        return composer.bottom > window.innerHeight - 1 && document.querySelector(".thread > :last-child")!.getBoundingClientRect().bottom <= composer.top;
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
      await page.getByRole("button", { name: "Poursuivre" }).click();
      await page.locator("h1 .badge", { hasText: "En direct" }).waitFor();
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
      await page.getByRole("status").filter({ hasText: "travaille" }).waitFor();
      const working = page.locator(".thread > :last-child");
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
      assert.equal(await working.evaluate((element) => element.getBoundingClientRect().bottom > window.innerHeight), true);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await fieldOf(page).fill("sans le profil");
      await fieldOf(page).press("Enter");
      const sent = sentOf(page, "sans le profil");
      await sent.waitFor();
      await page.waitForFunction(() => {
        const end = document.querySelector(".thread > :last-child")!.getBoundingClientRect();
        return end.bottom <= document.querySelector(".composer")!.getBoundingClientRect().top && end.bottom > 0;
      });
      assert.equal(await sent.isVisible(), true);
      assert.equal(await overflowOf(page), 0);
      assert.deepEqual(await tooSmallOf(page), []);
    } finally {
      await page.close();
    }
  });

  it("stands at the bottom of the window however short the thread, which does not scroll then on a wide screen", async () => {
    const instance = new PlayedInstance();
    instance.happened = 2;
    for (const [width, height] of [
      [390, undefined],
      [1440, 800],
    ] as const) {
      const page = await app().open(width, SESSION, instance.api);
      try {
        await page.getByRole("status").filter({ hasText: "travaille" }).waitFor();
        const composer = await page.locator(".composer").boundingBox();
        assert.ok(composer !== null);
        assert.ok(atBottom(composer.y + composer.height), `${width}`);
        // On a phone the summary alone may take the window: the page scrolls then, its composer still at the bottom.
        if (height !== undefined) assert.equal(await page.evaluate(() => document.documentElement.scrollHeight), height, `${width}`);
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
  /** What the actions of the session hold about its stop. */
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
      assert.equal(await focusedOf(page), "A:  Arrêter la session");
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
    const page = await app().open(1280, `${SESSION}?actions=on&stop=ask`, instance.api);
    try {
      const stop = page.getByRole("button", { name: "Arrêter la session" });
      await stop.click();
      await page.locator(".session-stop .btn.danger:disabled").waitFor();
      assert.deepEqual(instance.interrupted, []);
      release();
      await page.getByRole("status").filter({ hasText: "arrêt demandé…" }).waitFor();
      assert.deepEqual(instance.interrupted, [SESSION_ID]);
      assert.equal(await page.evaluate(() => window.location.hash), `${SESSION}?actions=on`);
      assert.equal(await focusedOf(page), "SPAN: arrêt demandé…");
      assert.equal(await page.locator(".session-stop").count(), 0);
      assert.equal(await page.locator("h1 .badge").innerText(), "En direct");
      instance.obey();
      await page.locator("h1 .badge", { hasText: "Interrompue" }).waitFor();
      await controlOf(page).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Poursuivre" }).waitFor();
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
