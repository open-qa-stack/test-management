# @open-qa-stack/web

The console of an instance: a React application built with Vite. As a rule of the workspace, it may import no package of the workspace other than `@open-qa-stack/domain`, and of it only the contract of sessions, `@open-qa-stack/domain/sessions`: the rest of the domain runs on Node.js.

The console shows the agents at work, live. It holds no sample data: everything it shows comes from the API of its instance, [`@open-qa-stack/api`](../../packages/api/README.md). Its first screen takes a request, which opens a session, and lists the sessions, the one whose agents are working first; the thread of a session fills event by event, and a session that ended can be replayed step by step. The other parts of the console are named in its navigation as « bientôt », and open nothing yet.

## Build and run

From the root of the workspace:

| Command                                  | What it does                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @open-qa-stack/web dev`   | Serves the console with Vite's development server; what it asks under `/api` goes to the API of an instance on `127.0.0.1:8080`. |
| `oqas --ui`                              | Serves the built console and the API of a test repository on one address, in one process: see [the command](../../packages/cli/docs/solo-command.md#the-console). |
| `pnpm --filter @open-qa-stack/web build` | Builds the console into `apps/web/dist/`.                                                                                        |
| `pnpm check`                             | Type-checks, builds every package, the console included, and runs the tests; it fails if the console does not build.             |

The console reaches its instance under `/api`, on its own origin, where the API serves its routes: the API serves the built console itself when it is given its folder, as `oqas --ui` has it do, or a reverse proxy sends that path to the API as it is, as Vite does while the console is developed.

## Layout

| Folder                        | What it holds                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/app.tsx` | The mount, and the application in a browser: it follows the address, names the page and moves the focus, beats a replay.              |
| `src/console.tsx`             | The console at a route: its screen in the shell.                                                                                      |
| `src/routing/`                | The route, read from the fragment of the address (`#/agent/sessions/<session>?show=talk`).                                            |
| `src/api/`                    | The client of the API, the one error every screen shows and its French wordings, the poll of a call, the stream of a session, whether a session ended. |
| `src/shell/`                  | The frame of every screen: the top bar and the navigation, beside the mark on a narrow screen, a sidebar from 1100 px wide.           |
| `src/ui/`                     | The components every screen shares, and their style sheet.                                                                            |
| `src/agent/`                  | The sessions: the words of the console for the steps of a thread, which `@open-qa-stack/domain/sessions` reads from the events of a session for every presentation, how a session is followed or replayed, its thread, and the panel of a look. |

A screen is a function of what the API told and of its route: it holds no state and listens to no event. A filter or a selection is an address, so that every state of the console can be linked to, and tested by rendering it. The application alone holds state — what the API sent, and how each session is read — and hands it to the screen that shows it. No screen calls the network: `src/api/` does, with the types of `@open-qa-stack/domain/sessions`.

### How a screen gets its data

The state of the console is a reducer, `src/agent/console-state.ts`; `src/agent/console-sync.ts` keeps it in step with the instance, and is the only caller of `src/api/`:

- The project is read once, again only while the API fails to describe it.
- The sessions are listed again and again for the entry of the agent: a list is asked only once the one before was answered and two seconds passed, and none is asked while the tab is hidden. A list asked before a session was opened, which may lack it, is ignored.
- The session an address opens does not depend on that list: it is read by its identifier (`GET /sessions/:id`) on arrival, and again each time its stream says it changed state: when it started, and when it ended, to learn what it came to. « Session introuvable » is shown only when the API answers `unknown_session`.
- The events of that session come from its stream (`GET /sessions/:id/events`). The stream connects again by itself after any cut — a browser gives up for good on an answer that is not a success — each time after a longer wait, up to eight seconds, asking for the events `?after=` the last it received. It ends, and is not opened again, on the event that says the session no longer goes on; a session that waits its turn, `queued`, goes on: its stream stays open, and its thread simply goes on once its agents start.

Until a session ended, the person speaks to its agents from a composer under the thread, which stays at the bottom of the window: Enter or its button sends (`POST /sessions/:id/messages`), Shift+Enter starts a new line. Nothing is shown before the instance took the message: its bubble comes with the stream, « en attente d’un agent » until the event that names the agent it reached, then « remis à … » — in a replay too, where the delivery comes when it happened. Where the message is — sent, or refused and why — belongs to the session followed, in the state, and is forgotten with it; a refused message stays in the field. A message sent to a session that still waits its turn is delivered when its agents start. Once the session ended, the composer stays, and asks what the agents are to do next; its button reads « Poursuivre la session »: what the person sends resumes the session (`POST /sessions/:id/resumption`) for a new turn, which its stream tells under the verdict of the turn before, in the same thread.

While a session goes on — it runs, or waits its turn — its bar offers to stop it, and never stops it at one press: « Arrêter » is a link to the same screen with `?stop=ask`, an address like any other state of the console, which opens a confirmation under the bar. The confirmation says what stopping does, then offers the way out, « Annuler », which takes the focus when it opens, and the button « Arrêter la session », which alone asks the instance (`POST /sessions/:id/interruption`). While the request is on its way the button cannot be pressed again; a request the instance refused is told under it, in the wordings of the console, and the button asks again. Once the instance took the request, the confirmation closes and the bar says « arrêt demandé… » where the link stood, which takes the focus: a session another process runs goes on until that process obeyed, and the console shows it « interrompue » only once its stream says so. Where the request is belongs to the session followed, in the state, and is forgotten with it. A session that ended offers nothing of it.

A session that did not change keeps the object the state already holds, so that what is computed from it is not computed again at every list.

Every failure of the API is an `ApiError` with the `code` of the problem the API answered, `error` when it gave none, or `unreachable` when no answer came. The console decides on that code alone: it words the codes it knows in French (`src/api/problem-text.ts`), shows the `detail` of the API otherwise, and says « Hors ligne » only for `unreachable`. A value the console does not know — a state, a phase, an outcome, a type of event — reads as a neutral one, or is ignored: a later version of the API does not break an earlier console. One predicate, `hasEnded` of `@open-qa-stack/domain/sessions`, tells whether a session no longer goes on, for the console as for the conversation of the command line: it has not while it is `queued` or `running`, and has in any other state, one the console does not know included.

## Styles and design tokens

The style sheets are written for a phone first. The rules of a sheet lay out a narrow screen; a wider one only adds to them, in `@media (min-width: …)` blocks — no sheet holds a `max-width` query — at two widths:

| From    | What it adds                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 720 px  | A line holds more: wider gutters, the role of an agent beside its name, the state of a session beside its facts. |
| 1100 px | A desktop: the navigation as a sidebar, with the project and what is coming; what an agent had before its eyes as a drawer at the right; lower controls, pointed at rather than pressed. |

A session is its thread alone, in one column that starts where the title of the page does. What an agent had before its eyes when it acted opens on demand, from the eye of that action, which names it in the address (`?look=6`): a panel that covers the screen below 1100 px, a drawer at the right from there, which the thread makes room for. The panel is titled by what it shows: « Page consultée », under the application and the address of the page, or « Fichier de test », under its path — the file of a test can be opened as soon as the agent hands it to a tool, while the test runs. The line of a run names the test, says how it ended and where the file is, and unfolds in place on the verdict of each test the run ran, what the tool answered when the run did not pass, and the code. The code of a test, in the panel as in the line of a run, is coloured by [Shiki](https://shiki.style) with the grammar of TypeScript and its engine of regular expressions in JavaScript, in a theme whose colours are variables of the sheet (`.code` in `src/ui/ui.css`), so that it takes the colours of the console: Shiki and the grammar are loaded apart, the first time code is drawn, and until then, or if they cannot be loaded, the code is drawn plain. A count is written in the singular or the plural as French has it, by one helper, `src/ui/counted.ts`. Its link « Fermer », the Escape key and the way back of the browser close it; the focus goes to its title when it opens, and back to the eye when it closes. An address whose `look` names no action that looked at something opens nothing. The name of an agent, in the thread, follows that agent (`?agent=planner`): the thread then shows it alone. The filters of the thread keep what is said (`?show=talk`), the notes of the harness included; what is done (`?show=actions`); or the verdicts (`?show=verdicts`), of the harness and of the reviewers alike, with the plans it accepted and the verdicts of the tests. Below 1100 px all that is pressed is 44 px high and wide at least, and a field is written at 16 px, so that a phone does not zoom on it. What moves does so only under `prefers-reduced-motion: no-preference`.

Every text a thread holds is shown whole: what an agent and the harness say, a verdict, a note, the answer of a tool, what an agent looked at. A verdict, of the harness or of a reviewer, is one form of card: its author first — « Harnais », marked « contrôle automatique », or the agent that reviewed, marked « agent relecteur » — then what it came to, the code of the gate that refused, what it is about (the phase, the scenario, the tool, or what the reviewer reviewed), what it says, and what it was told with under « Détails »: the text of the harness as it wrote it, or the call of the reviewer. A refusal of the harness is read by its form: what was refused, then why and what to do, the page it quotes folded under its address. A reason too long for a few lines shows its first six lines over a button « Lire la suite », which unfolds it in place and says so to assistive technology (`aria-expanded`), then « Replier »; which texts are unfolded belongs to the session followed, in the state. A one-line ellipsis is left only where the whole text is one press away or already on the screen: the first line of a reasoning, of a row of notes and of an action, in the line that unfolds it; the title of the session in the breadcrumb, under which the page is titled with it; the name of the project in the sidebar, which the top bar shows whole beside it. What the session works on opens its thread, as soon as its configuration is resolved, in a card every filter keeps: the levels of the pyramid of tests asked, which alone are designed, the applications and the environment, with the key of the configuration that sets the levels. A plan the harness accepted is a card with a cell for each scenario, folded to its level, its title, its case and its application: a cell unfolds on all the plan says of it — what it verifies, its facts, its sources, its data, each step with the texts it expects the screen to show or no longer show — then on the scenario as the event told it, folded under « Détails ». The refusals of the harness about a scenario before its plan was accepted are counted on its line and told under its steps. The notes of the harness that say the same of several sources in a row, such as the cards it kept because they were up to date, are one line, what they say around the name of a source and how many sources, which unfolds on each note: the fold of the thread groups them, for the terminal too.

Each selector is styled in one sheet, the one of its component, and `src/main.tsx` imports them in this order: `src/tokens.css`, `src/base.css` (the page, links, the focus ring, the utility classes), `src/ui/ui.css` (the shared components), `src/shell/shell.css`, `src/agent/session.css`, `src/agent/agent-home.css`.

Colours and geometry are CSS custom properties, declared on `:root` in `src/tokens.css` as a phone needs them; the same file changes, for the wider screens, the few that change. That file is the only place a colour is written: every other style sheet, component and page refers to a token with `var(--name)`, and a test fails on any colour literal (`#fff`, `rgb(…)`, `hsl(…)`…) or named colour (`white`) written elsewhere. It reads every page, style sheet, drawing and script of the package, outside `node_modules/`, `dist/` and `test/`: colour literals anywhere in them, named colours in CSS declarations, in the attributes and style elements of `.html` and `.svg` files, and in the string literals of scripts and components. The name of a token is read as a word too: one that is the name of a colour, such as `--canvas`, fails.

To add a token:

1. Declare it in `src/tokens.css`, next to the tokens of the same family (`--primary-soft` beside `--primary`).
2. Use it with `var(--name)` where it applies.
3. Add its name and value to `REFERENCE_TOKENS` in `test/tokens.test.ts` if it is a reference token of the design — every token of the geometry is one; a secondary colour goes to `SECONDARY_COLOURS`.

### Geometry

No sheet writes a length of its own. Every margin, padding, gap and offset, every radius, every size, line height and weight of the text, every border and shadow is a token, or `calc()`, `min()`, `max()` of tokens; `0`, `auto` and percentages are the only literals. `test/geometry.test.ts` fails on anything else, on a custom property declared outside the tokens file, and on a scale that breaks one of the rules below.

**Spacing.** One scale, on a grid of 4 px: `--space-1` `-2` `-3` `-4` `-6` `-8` `-12`, each named after its count of 4 px (4, 8, 12, 16, 24, 32, 48 px). Sizes are on the same grid: a control (`--control`, 44 px, 32 px on a desktop), a row (`--row`, 48 px, 32 px on a desktop, so that the line inside its hairlines stays a finger high on a phone), what a finger presses (`--tap`, 44 px, 24 px on a desktop), the top bar (`--bar`), the pictures of who speaks (`--picture` 32 px, `--picture-sm` 20 px), the columns. An icon is drawn at 12, 16, 20 or 24 px, its line 1.5 px thick at every size.

**Proximity.** What belongs together stands closer than what does not, by a factor of two at each level:

| Token        | Step  | Between                                                                                                    |
| ------------ | ----- | ---------------------------------------------------------------------------------------------------------- |
| `--gap-line` | 4 px  | a line and what hangs under it: the answer of a tool, the status of a message, the source of a scenario    |
| `--gap-row`  | 8 px  | the rows of one turn; the harness that hands the work over and the turn it opens; the head and text of a card |
| `--gap-turn` | 16 px | two turns of the thread; the bar, the passes, the filters and the thread of a session                      |
| `--gap-pass` | 32 px | a pass and what came before it                                                                             |

On a line, the parts of a row are 8 px apart, a dot and its word in a pill 4 px; a surface is padded at least as much as what it holds is spaced.

**Radii.** A surface set in another takes the radius of the outer one less the padding between them, rounded down to a step, and the least step when nothing is left; it never takes more than what holds it.

| Token              | Radius | Taken by                                                                                                        |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------------- |
| `--radius-panel`   | 16 px  | what frames controls 8 px from its edge: the bar of a session, the field of the composer and of the entry; a bubble |
| `--radius-card`    | 12 px  | a card: the list of the sessions, a verdict, a plan, a result                                                    |
| `--radius-control` | 8 px   | a control (16 − 8), the row of an action, a frame, the picture of an agent (a quarter of its side)               |
| `--radius-inner`   | 4 px   | what a row or a card holds: the eye of an action (8 − 4), a code, the answer of a tool, a small picture           |
| `--radius-pill`    | —      | chips, badges, dots                                                                                              |

**Type.** One modular scale, 14 px times a power of 1.125 (a major second, the gentlest ratio that still tells two neighbouring roles apart in a dense console), rounded to the pixel; a line height on the grid for each role; three weights (400, 500, 600). The scale is the same at every width: the field a person types in is 16 px on a phone because the reading role is, and a desktop gets its density from lower controls, not from smaller text.

| Role      | Token            | Size / line | For                                                              |
| --------- | ---------------- | ----------- | ---------------------------------------------------------------- |
| caption   | `--type-caption` | 11 / 16 px  | times, badges, labels in capitals, code                          |
| small     | `--type-small`   | 12 / 16 px  | what is said beside: roles, facts, notes of the harness, chips   |
| body      | `--type-body`    | 14 / 20 px  | the console: actions, buttons, the navigation, rows              |
| reading   | `--type-reading` | 16 / 24 px  | what is read or typed: what an agent says, a verdict, a request  |
| heading   | `--type-heading` | 18 / 24 px  | the title of a panel                                             |
| title     | `--type-title`   | 22 / 28 px  | the title of a page                                              |
| display   | `--type-display` | 28 / 36 px  | the question of the entry                                        |

What is read at length — what an agent says, a verdict, a note — keeps to `--measure`, 64 `ch`, about 70 characters a line.

A note of the harness, small text in a line or two, takes the wider `--measure-wide` (96ch).

**Keylines.** A page has one left edge, its gutter: the breadcrumb, the title, the bar, the passes, the filters, the thread and the composer start on it. The thread has a second one at every width, `--keyline`, the picture of an agent plus the gap beside it: what an agent said and did, the lines and the notes of the harness, the verdicts and the cards start there. What a surface holds is set in by `--pad`, a row and a card alike; the text of a line of the harness starts after the room of its mark. At the right, every time ends `--pad` from the edge of the column: the time of a turn, of a card, and of an action, whose eye stands in a column before it.

**Lines and elevation.** A border is `--hairline` wide; a focus ring and an accent are `--stroke`. A surface stands at one of two heights: resting on the page (`--elevation-rest`), or raised over what scrolls under it (`--elevation-raised`: a bar that follows the page, the composer, the drawer).

## Tests

The tests run with Vitest. Components and screens are rendered in Node with `react-dom/server` and read as a person reads them: their text, and where their links lead. The layout tests build the console with Vite and use it in Chromium, at the widths of a phone and of a desktop, where they check what overflows, what a finger can press, and how the look of an action opens, closes and moves the focus: its files are answered from the build, and what it asks the API is answered by the test, which plays an instance (`test/played-instance.ts`) whose session goes on, completes or is interrupted once it was asked to stop, which opens a session that waits in the queue until it starts, whose stream is refused then opens again, which takes a message and delivers it or refuses it, which answers a problem, or which cannot be reached.

The coverage of Node counts only the modules a test loads there, and two modules only run in a browser: `src/main.tsx`, which mounts the console, and `src/app.tsx`, which follows the address, names the page, moves the focus, closes a look on Escape, asks for the stop a person confirmed and beats the clock of a replay. A layout test measures them in Chromium instead, maps the coverage of the build back to their lines through its source map, and fails on any line that did not run. The manifest lists them under `coverage.measuredInBrowser`, so that `pnpm check` leaves their coverage to that test. Keep them small: what can be a function of its arguments belongs in a module Node tests.

`tsconfig.json` type-checks the console against the browser's types only, so code that needs Node does not compile; `test/tsconfig.json` adds Node's types for the tests.
