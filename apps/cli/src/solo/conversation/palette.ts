/**
 * The look of the conversation, in one place: its colours, its glyphs and its layout.
 *
 * @remarks
 * Every component takes what it draws with from here, so that the conversation reads as one thing.
 *
 * Colours. A colour always means something, and the same thing everywhere: {@link TONES} names what, and a
 * component asks for a tone, never for a colour. Nothing is told by colour alone — a state has its glyph, a
 * speaker its mark and its name — so that a terminal without colour, or one told `NO_COLOR`, loses nothing.
 *
 * Glyphs. Each has an ASCII twin, {@link ASCII}, drawn when the terminal does not say it reads UTF-8.
 *
 * Layout.
 * - The first column is the gutter: it holds the mark of who speaks, or the state of an action. What is said
 *   or done starts {@link GUTTER} columns in, and what belongs to it — the answer of a tool, the reason of a
 *   refusal, the scenarios of a plan — {@link GUTTER} columns further.
 * - One empty line opens each speaker and each card; the lines of one speaker follow one another without any.
 * - A phase is a rule across the width, its title at the left; nothing else is ruled or boxed.
 * - A text wraps at the width of the terminal and never overflows; what must stay on one line — an action,
 *   a session of a list — is cut with an ellipsis. The narrowest terminal this is laid out for has 60 columns.
 *
 * What a thread itself holds — what an agent wrote, the name of a test — is written as it is, in any terminal.
 */

/** The width of the gutter, and of each further indentation, in columns. */
export const GUTTER = 2;

/** What a colour means. */
export type Tone = "accent" | "person" | "cartographer" | "planner" | "writer" | "reviewer" | "harness" | "ok" | "ko" | "warn" | "muted";

/** How a text of a tone is drawn: the properties of the `Text` of Ink that say it. */
export interface TextStyle {
  readonly color?: string;
  readonly dimColor?: boolean;
}

/**
 * The colour of each tone, among the sixteen every terminal has. The harness speaks in the colour of the text,
 * and what is muted is dimmed rather than coloured: dimming is no colour, and stays in a terminal without any.
 */
const TONES: Readonly<Record<Tone, TextStyle>> = {
  accent: { color: "cyan" },
  person: { color: "cyan" },
  cartographer: { color: "blue" },
  planner: { color: "magenta" },
  writer: { color: "green" },
  reviewer: { color: "yellow" },
  harness: {},
  ok: { color: "green" },
  ko: { color: "red" },
  warn: { color: "yellow" },
  muted: { dimColor: true },
};

/** The glyphs of the conversation. */
export interface Glyphs {
  /** What a rule is drawn with. */
  readonly rule: string;
  /** Before what the person types. */
  readonly prompt: string;
  /** Before the line a list has selected. */
  readonly pointer: string;
  /** An action that passed. */
  readonly passed: string;
  /** An action that failed, or a refusal. */
  readonly failed: string;
  /** An action that ended and says neither. */
  readonly done: string;
  /** Between two facts on one line. */
  readonly separator: string;
  /** From who hands over to who takes. */
  readonly arrow: string;
  /** The spinner of what goes on, as `ink-spinner` names it. */
  readonly spinner: "dots" | "line";
}

const UNICODE: Glyphs = { rule: "─", prompt: "›", pointer: "❯", passed: "✓", failed: "✗", done: "·", separator: "·", arrow: "→", spinner: "dots" };

const ASCII: Glyphs = { rule: "-", prompt: ">", pointer: ">", passed: "+", failed: "x", done: "-", separator: "-", arrow: "->", spinner: "line" };

/** How the conversation is drawn in one terminal. */
export interface Theme {
  readonly glyphs: Glyphs;
  /** Whether the terminal draws the glyphs beyond ASCII. */
  readonly unicode: boolean;
  /**
   * @param tone - What the colour means.
   * @returns How to draw a text of that tone; without its colour in a terminal that has none.
   */
  readonly ink: (tone: Tone) => TextStyle;
}

/** A style without its colour, for a terminal that has none. */
function withoutColor({ color: _left, ...kept }: TextStyle): TextStyle {
  return kept;
}

/**
 * Reads how to draw the conversation from the environment of the command.
 *
 * @param env - The environment.
 * @returns The theme: without colour when `NO_COLOR` is set to anything or the terminal is `dumb`; in ASCII
 * unless the locale — `LC_ALL`, then `LC_CTYPE`, then `LANG` — names UTF-8 and the terminal is neither `dumb`
 * nor the console of Linux, which draws few glyphs.
 */
export function themeOf(env: Readonly<Record<string, string | undefined>>): Theme {
  const terminal = env["TERM"] ?? "";
  const colored = (env["NO_COLOR"] ?? "") === "" && terminal !== "dumb";
  const locale = [env["LC_ALL"], env["LC_CTYPE"], env["LANG"]].find((value) => value !== undefined && value !== "") ?? "";
  const unicode = /utf-?8/i.test(locale) && terminal !== "dumb" && terminal !== "linux";
  return { glyphs: unicode ? UNICODE : ASCII, unicode, ink: (tone) => (colored ? TONES[tone] : withoutColor(TONES[tone])) };
}
