# @open-qa-stack/web

The console of an instance: a React application built with Vite. As a rule of the workspace, it may import no package of the workspace other than `@open-qa-stack/shared`.

## Build and run

From the root of the workspace:

| Command | What it does |
|---|---|
| `pnpm --filter @open-qa-stack/web dev` | Serves the console with Vite's development server. |
| `pnpm --filter @open-qa-stack/web build` | Builds the console into `apps/web/dist/`. |
| `pnpm check` | Type-checks, builds every package, the console included, and runs the tests; it fails if the console does not build. |

## Layout

`src/main.tsx` mounts the console; `src/shell.tsx` is the frame of every screen. Below 960 px wide, the shell keeps a tab bar at the bottom and hides the sidebar; from 960 px, it shows the sidebar and hides the tab bar.

## Design tokens

Colours, radius, row height and text size are CSS custom properties, declared on `:root` in `src/tokens.css`. That file is the only place a colour is written: every other style sheet, component and page refers to a token with `var(--name)`, and a test fails on any colour literal (`#fff`, `rgb(…)`, `hsl(…)`…) or named colour (`white`) written elsewhere. It reads every page, style sheet, drawing and script of the package, outside `node_modules/`, `dist/` and `test/`: colour literals anywhere in them, named colours in CSS declarations, in the attributes and style elements of `.html` and `.svg` files, and in the string literals of scripts and components.

To add a token:

1. Declare it in `src/tokens.css`, next to the tokens of the same family (`--primary-hover` beside `--primary`).
2. Use it with `var(--name)` where it applies.
3. If it is a reference token of the design, add its name and value to `REFERENCE_TOKENS` in `test/tokens.test.ts`; a secondary colour goes to `SECONDARY_COLOURS`.

## Tests

The tests run with `node --test`. `test/jsx.ts` registers a loader that compiles `.tsx` modules with the same transform as Vite, so components are rendered in Node with `react-dom/server`. The layout tests build the console with Vite and open it in Chromium, every request answered from the build.

Node's coverage counts only the modules a test loads, and no test loads `src/main.tsx` in Node: it mounts the console in a browser. A layout test measures it in Chromium instead, maps the coverage of the build back to `src/main.tsx` through its source map, and fails on any line of it that did not run. Keep that module to the mount alone. The manifest lists it under `coverage.measuredInBrowser`, so that `pnpm check` leaves its coverage to that test.

`tsconfig.json` type-checks the console against the browser's types only, so code that needs Node does not compile; `test/tsconfig.json` adds Node's types for the tests.
