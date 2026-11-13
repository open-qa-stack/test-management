# @open-qa-stack/web

The console of an instance: a React application built with Vite. As a rule of the workspace, it may import no package of the workspace other than `@open-qa-stack/shared`.

## Build and run

From the root of the workspace:

| Command | What it does |
|---|---|
| `pnpm --filter @open-qa-stack/web dev` | Serves the console with Vite's development server. |
| `pnpm --filter @open-qa-stack/web build` | Builds the console into `apps/web/dist/`. |
| `pnpm check` | Type-checks, builds every package, the console included, and runs the tests; it fails if the console does not build. |

`src/main.tsx` mounts the console; `src/shell.tsx` is the frame of every screen.

## Tests

The tests run with `node --test`. `test/jsx.ts` registers a loader that compiles `.tsx` modules with the same transform as Vite, so components are rendered in Node with `react-dom/server`.

`tsconfig.json` type-checks the console against the browser's types only, so code that needs Node does not compile; `test/tsconfig.json` adds Node's types for the tests.
