import { exportFile, type ElementDraft } from "@open-qa-stack/tools";
import { HandedInMap, type HandedInMapOptions, type MapPart } from "../source-workflow/handed-in-map.ts";
import type { ScreenTrail } from "./screen-trail.ts";

/** Most observations a domain is handed in with. */
export const MAX_OBSERVATIONS = 40;
/** Longest feature of a screen, and longest statement of an observation, in characters. */
const MAX_FEATURE_LENGTH = 80;
const MAX_STATEMENT_LENGTH = 300;
/** Route of the home of an application, where its exploration starts. */
const HOME = "/";
/** Most screens a refusal names. */
const MAX_NAMED_SCREENS = 20;

/** A part of a user interface: a whole screen, or one thing a user does on it. */
interface ScreenPart extends MapPart {
  readonly kind: "screen" | "feature";
  /** Route of the screen. */
  readonly screen: string;
}

/** What a map of a user interface needs. */
export interface ApplicationMapOptions extends HandedInMapOptions {
  /** What the agent saw of the user interface. */
  readonly trail: ScreenTrail;
}

/**
 * The map of the user interface of an application, as the agent that explores it hands it in, domain by
 * domain.
 *
 * @remarks
 * An element is a screen, by its route, or one thing a user does on it, by its route and a name the agent
 * gives: `/customers § Search a customer`. The harness holds what is handed in to what the agent opened: a
 * screen is placed once the agent opened it, and one a link led to may be set aside without being opened,
 * such as a way out of the application.
 *
 * With a domain the agent hands in what it observed: each observation names the screen it was made on, says
 * in one sentence what the application does, and may quote the texts the screen showed. An observation is
 * what was seen, not what is specified: the harness refuses one made on a screen never opened, and a text
 * its screen never showed, and writes those it keeps at the end of the file of the domain, under their own
 * heading. A domain handed in without any observation is asked about once: the same call again confirms
 * that the agent saw nothing there a test can verify.
 *
 * The map is over once every screen opened is in a domain or set aside, by itself or by one thing done on
 * it, and every screen a link led to was opened or set aside. What every map does besides is that of
 * `HandedInMap`.
 */
export class ApplicationMap extends HandedInMap<ScreenPart> {
  private readonly trail: ScreenTrail;
  /** How many observations the call under way keeps. */
  private observed = 0;

  /** @param options - What the map needs. */
  public constructor(options: ApplicationMapOptions) {
    const screen = { type: "string", description: "Route of the screen, as the results of the browser tools name it: /customers, /customers/:id." };
    const feature = {
      type: "string",
      description: "One thing a user does on the screen, in a few words, such as Search a customer; left out for the whole screen.",
    };
    super(options, {
      things: "screens",
      one: "a screen",
      given: { properties: { screen, feature }, required: ["screen"] },
      write:
        "Hands one functional domain in: its elements, each a screen or one thing a user does on it with its role, what you observed on those screens, then the markdown body of its file, which names every element between backticks. A domain handed in again replaces what was kept of it.",
      aside:
        "Sets aside the screens that serve no functional area, with why, such as an error page or a way out of the application. They stay in the source, in no domain.",
      noElement: "The domain has no element. Give its screens, or what a user does on them, in elements.",
      noAside: "Give in elements the screens to set aside.",
      hint: "; open with the browser tools a screen you have not opened yet",
    });
    this.trail = options.trail;
  }

  /** {@inheritDoc HandedInMap.part} */
  protected part(given: Readonly<Record<string, unknown>>): ScreenPart | string {
    const written = String(given["screen"]);
    const screen = this.trail.route(written);
    if (screen === undefined) return this.unknown(written);
    if (given["feature"] === undefined) return { name: screen, kind: "screen", screen };
    const feature = typeof given["feature"] === "string" ? given["feature"].trim().replace(/\s+/g, " ") : "";
    if (feature === "" || feature.length > MAX_FEATURE_LENGTH)
      return `Name what a user does on ${screen} in ${MAX_FEATURE_LENGTH} characters at most, or leave feature out for the whole screen.`;
    return { name: `${screen} § ${feature}`, kind: "feature", screen };
  }

  /** {@inheritDoc HandedInMap.placeProblem} */
  protected placeProblem({ screen }: ScreenPart): string | undefined {
    return this.opened(screen)
      ? undefined
      : `You have not opened ${screen}: a link led to it. Open it with the browser tools, look at what it shows, then place it.`;
  }

  /** A screen a link led to may be set aside without being opened. */
  protected asideProblem(): string | undefined {
    return undefined;
  }

  /** What is in no domain and not set aside: each screen opened nothing was said of, then each screen a link led to that was neither opened nor set aside; the home, while nothing was opened. */
  protected remaining(settled: readonly ScreenPart[]): ScreenPart[] {
    const said = new Set(settled.map((part) => part.screen));
    const known = [...this.trail.visited.map((screen) => screen.route), ...this.trail.pending];
    // Before anything is opened, the home is still to explore: a map of nothing is not a map.
    return (known.length === 0 ? [HOME] : known).filter((screen) => !said.has(screen)).map((screen) => ({ name: screen, kind: "screen", screen }));
  }

  /** The text of a part: what its screen last showed; nothing for a screen never opened. */
  protected async text({ screen }: ScreenPart): Promise<string> {
    return this.trail.visited.find((visited) => visited.route === screen)?.page ?? "";
  }

  /** {@inheritDoc HandedInMap.draft} */
  protected draft({ name, kind, screen }: ScreenPart, text: string): ElementDraft {
    const visited = this.trail.visited.find((candidate) => candidate.route === screen);
    const summary = [
      kind === "screen"
        ? `screen ${screen}${visited === undefined ? ", never opened" : ` — ${visited.title}`}`
        : `feature ${name.slice(screen.length + 3)} of the screen ${screen}`,
      ...(visited === undefined || visited.links.length === 0 ? [] : [`links: ${visited.links.join(", ")}`]),
    ];
    return {
      name,
      kind,
      summary: summary.join("\n  "),
      definition: text,
      names: [],
      links: [],
      file: exportFile(kind === "screen" ? "screens" : "features", name, "txt"),
    };
  }

  /** A whole screen is in a domain once anything done on it is: it is not set aside then. */
  protected held(part: ScreenPart, element: ScreenPart): boolean {
    return part.kind === "screen" ? element.screen === part.screen : element.name === part.name;
  }

  /** A screen left that was never opened is named so, since it is to open before it is placed. */
  protected called(part: ScreenPart): string {
    return this.opened(part.screen) ? part.name : `${part.name} (not opened)`;
  }

  /** `write_domain` takes what the agent observed on the screens of the domain. */
  protected more(): Readonly<Record<string, unknown>> {
    return {
      observations: {
        type: "array",
        maxItems: MAX_OBSERVATIONS,
        description:
          "What you observed on these screens that a test can verify: a rule, a control, a message, a state. Only what you saw; nothing you suppose.",
        items: {
          type: "object",
          properties: {
            screen: { type: "string", description: "Route of the screen you observed it on." },
            statement: { type: "string", minLength: 1, description: "What the application does, in one sentence." },
            shows: {
              type: "array",
              maxItems: 6,
              items: { type: "string", minLength: 1 },
              description: "The exact texts the screen showed, as you read them; left out when no text tells it.",
            },
          },
          required: ["screen", "statement"],
        },
      },
    };
  }

  /** What is wrong with the observations of a call, and those kept, as the end of the file of the domain. */
  protected extra(args: Readonly<Record<string, unknown>>): { readonly problems: readonly string[]; readonly added: string } {
    const given = Array.isArray(args["observations"]) ? (args["observations"] as readonly Readonly<Record<string, unknown>>[]) : [];
    const problems: string[] = [];
    const lines: string[] = [];
    if (given.length > MAX_OBSERVATIONS)
      problems.push(`The domain has ${given.length} observations, ${MAX_OBSERVATIONS} at most. Keep those a test can verify.`);
    for (const observation of given.slice(0, MAX_OBSERVATIONS)) {
      const written = String(observation["screen"]);
      const screen = this.trail.route(written);
      const statement = typeof observation["statement"] === "string" ? observation["statement"].trim().replace(/\s+/g, " ") : "";
      const shows = Array.isArray(observation["shows"]) ? observation["shows"].filter((text): text is string => typeof text === "string") : [];
      if (screen === undefined || !this.opened(screen))
        problems.push(
          screen === undefined
            ? this.unknown(written)
            : `An observation is made on ${screen}, which you have not opened. Observe only what a screen showed you.`,
        );
      else if (statement === "" || statement.length > MAX_STATEMENT_LENGTH)
        problems.push(`Say what you observed on ${screen} in one sentence of ${MAX_STATEMENT_LENGTH} characters at most.`);
      else {
        const unseen = shows.filter((text) => !this.trail.shows(screen, text));
        for (const text of unseen)
          problems.push(
            `${screen} never showed "${text}". Copy the text as the page gives it, or leave it out of shows: an observation holds only what was seen.`,
          );
        const seen = shows.length === 0 ? "" : ` Seen: ${shows.map((text) => JSON.stringify(text)).join(", ")}.`;
        lines.push(`- \`${screen}\`: ${statement}${seen}`);
      }
    }
    this.observed = lines.length;
    const heading = "## Observed on the screens\n\nWhat follows was seen while exploring the application, not read in a specification.\n";
    return { problems, added: lines.length === 0 ? "" : `\n\n${heading}\n${lines.join("\n")}` };
  }

  /** The question asked once about a domain handed in without any observation; nothing when it has some. */
  protected question(id: string): string | undefined {
    if (this.observed > 0) return undefined;
    this.record("info", `The harness warned the agent that the domain ${id} was handed in without any observation.`);
    return `Warning: the domain ${id} is not kept yet. You handed it in without any observation. Say what the application answered to what you tried on its screens, such as a search that finds nothing or an address that does not exist, with the texts it showed; if you saw nothing there a test can verify, call write_domain again with the same domain to confirm.`;
  }

  private opened(screen: string): boolean {
    return this.trail.visited.some((visited) => visited.route === screen);
  }

  private unknown(written: string): string {
    const known = [...this.trail.visited.map((screen) => screen.route), ...this.trail.pending];
    const more = known.length > MAX_NAMED_SCREENS ? `, and ${known.length - MAX_NAMED_SCREENS} more` : "";
    return `${written} is no screen of ${this.sourceId} you opened or saw a link to. The screens so far: ${known.slice(0, MAX_NAMED_SCREENS).join(", ") || "none"}${more}.`;
  }
}
