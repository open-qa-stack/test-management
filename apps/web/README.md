# @open-qa-stack/web

The console of an instance: a React application built with Vite. As a rule of the workspace, it may import no package of the workspace other than `@open-qa-stack/shared`.

The console shows the agents at work, live. It holds no sample data: everything it shows comes from the API of its instance, [`@open-qa-stack/api`](../../packages/api/README.md). Its first screen takes a request, which opens a session, and lists the sessions, the one whose agents are working first; the thread of a session fills event by event, and a session that ended can be replayed step by step. The other parts of the console are named in its navigation as « bientôt », and open nothing yet.

## Build and run

From the root of the workspace:

| Command                                  | What it does                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @open-qa-stack/web dev`   | Serves the console with Vite's development server; what it asks under `/api` goes to the API of an instance on `127.0.0.1:8080`. |
| `pnpm --filter @open-qa-stack/web build` | Builds the console into `apps/web/dist/`.                                                                                        |
| `pnpm check`                             | Type-checks, builds every package, the console included, and runs the tests; it fails if the console does not build.             |

The console reaches its instance under `/api`, on its own origin: in production a reverse proxy routes that path to the API, and Vite does the same while the console is developed.

## Layout

| Folder                        | What it holds                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`, `src/app.tsx` | The mount, and the application in a browser: it follows the address, names the page and moves the focus, beats a replay.              |
| `src/console.tsx`             | The console at a route: its screen in the shell.                                                                                      |
| `src/routing/`                | The route, read from the fragment of the address (`#/agent/sessions/<session>?show=talk`).                                            |
| `src/api/`                    | The client of the API, the one error every screen shows and its French wordings, the poll of a call, the stream of a session.         |
| `src/shell/`                  | The frame of every screen: the top bar and the navigation, beside the mark on a narrow screen, a sidebar from 1100 px wide.           |
| `src/ui/`                     | The components every screen shares, and their style sheet.                                                                            |
| `src/agent/`                  | The sessions: how the events of one read as the steps of its thread, how it is followed or replayed, its thread, and the panel of a look. |

A screen is a function of what the API told and of its route: it holds no state and listens to no event. A filter or a selection is an address, so that every state of the console can be linked to, and tested by rendering it. The application alone holds state — what the API sent, and how each session is read — and hands it to the screen that shows it. No screen calls the network: `src/api/` does, with the types of `@open-qa-stack/shared/sessions`.

### How a screen gets its data

The state of the console is a reducer, `src/agent/console-state.ts`; `src/agent/console-sync.ts` keeps it in step with the instance, and is the only caller of `src/api/`:

- The project is read once, again only while the API fails to describe it.
- The sessions are listed again and again for the entry of the agent: a list is asked only once the one before was answered and two seconds passed, and none is asked while the tab is hidden. A list asked before a session was opened, which may lack it, is ignored.
- The session an address opens does not depend on that list: it is read by its identifier (`GET /sessions/:id`) on arrival, and again once its stream ended, to learn what it came to. « Session introuvable » is shown only when the API answers `unknown_session`.
- The events of that session come from its stream (`GET /sessions/:id/events`). The stream connects again by itself after any cut — a browser gives up for good on an answer that is not a success — each time after a longer wait, up to eight seconds, asking for the events `?after=` the last it received. It ends, and is not opened again, on the event that says the session no longer goes on.

A session that did not change keeps the object the state already holds, so that what is computed from it is not computed again at every list.

Every failure of the API is an `ApiError` with the `code` of the problem the API answered, `error` when it gave none, or `unreachable` when no answer came. The console decides on that code alone: it words the codes it knows in French (`src/api/problem-text.ts`), shows the `detail` of the API otherwise, and says « Hors ligne » only for `unreachable`. A value the console does not know — a state, a phase, an outcome, a type of event — reads as a neutral one, or is ignored: a later version of the API does not break an earlier console.

## Styles and design tokens

The style sheets are written for a phone first. The rules of a sheet lay out a narrow screen; a wider one only adds to them, in `@media (min-width: …)` blocks — no sheet holds a `max-width` query — at two widths:

| From    | What it adds                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 720 px  | A line holds more: wider gutters, the role of an agent beside its name, what belongs to the harness set in under the pictures of the agents, the state of a session beside its facts.      |
| 1100 px | A desktop: the navigation as a sidebar, with the project and what is coming; what an agent had before its eyes as a drawer at the right; denser text and smaller controls.      |

A session is its thread alone, in one column. What an agent had before its eyes when it acted opens on demand, from the eye of that action, which names it in the address (`?look=6`): a panel that covers the screen below 1100 px, a drawer at the right from there, which the thread makes room for. Its link « Fermer », the Escape key and the way back of the browser close it; the focus goes to its title when it opens, and back to the eye when it closes. An address whose `look` names no action that looked at something opens nothing. The name of an agent, in the thread, follows that agent (`?agent=planner`): the thread then shows it alone. All that is pressed is 44 px high and wide at least, and the field of the request is written at 16 px, so that a phone does not zoom on it. What moves does so only under `prefers-reduced-motion: no-preference`.

Each selector is styled in one sheet, the one of its component, and `src/main.tsx` imports them in this order: `src/tokens.css`, `src/base.css` (the page, links, the focus ring, the utility classes), `src/ui/ui.css` (the shared components), `src/shell/shell.css`, `src/agent/session.css`, `src/agent/agent-home.css`.

Colours and the sizes the sheets share — the least side of what is pressed (`--tap`), the gutter of a page, the padding of a card, the radii and the type scale — are CSS custom properties, declared on `:root` in `src/tokens.css` as a phone needs them; the same file loosens the sizes for the wider screens. That file is the only place a colour is written: every other style sheet, component and page refers to a token with `var(--name)`, and a test fails on any colour literal (`#fff`, `rgb(…)`, `hsl(…)`…) or named colour (`white`) written elsewhere. It reads every page, style sheet, drawing and script of the package, outside `node_modules/`, `dist/` and `test/`: colour literals anywhere in them, named colours in CSS declarations, in the attributes and style elements of `.html` and `.svg` files, and in the string literals of scripts and components. The name of a token is read as a word too: one that is the name of a colour, such as `--canvas`, fails.

To add a token:

1. Declare it in `src/tokens.css`, next to the tokens of the same family (`--primary-soft` beside `--primary`).
2. Use it with `var(--name)` where it applies.
3. If it is a reference token of the design, add its name and value to `REFERENCE_TOKENS` in `test/tokens.test.ts`; a secondary colour goes to `SECONDARY_COLOURS`.

## Tests

The tests run with Vitest. Components and screens are rendered in Node with `react-dom/server` and read as a person reads them: their text, and where their links lead. The layout tests build the console with Vite and use it in Chromium, at the widths of a phone and of a desktop, where they check what overflows, what a finger can press, and how the look of an action opens, closes and moves the focus: its files are answered from the build, and what it asks the API is answered by the test, which plays an instance whose session goes on or completes, whose stream is refused then opens again, which answers a problem, or which cannot be reached.

The coverage of Node counts only the modules a test loads there, and two modules only run in a browser: `src/main.tsx`, which mounts the console, and `src/app.tsx`, which follows the address, names the page, moves the focus, closes a look on Escape and beats the clock of a replay. A layout test measures them in Chromium instead, maps the coverage of the build back to their lines through its source map, and fails on any line that did not run. The manifest lists them under `coverage.measuredInBrowser`, so that `pnpm check` leaves their coverage to that test. Keep them small: what can be a function of its arguments belongs in a module Node tests.

`tsconfig.json` type-checks the console against the browser's types only, so code that needs Node does not compile; `test/tsconfig.json` adds Node's types for the tests.
