# AGENTS.md

Welcome to the Mediaplayer App project. This file provides critical context, guidelines, and commands for contributors and AI assistants working on this codebase.

## 1. Project Overview & Tech Stack

- **Type**: Media Player Application
- **Platform**: Cross-platform desktop (Electron) and Web UI.
- **Frontend**: Vue 3, Vite, Tailwind CSS (v4), HTML5 Media APIs.
- **Backend/Main Process**: Node.js, Express, better-sqlite3.
- **Testing**: Vitest (Unit/Integration) and Playwright (E2E/Visual).

## 2. Core Development Commands (npm)

- **Install Dependencies**: `npm install`
- **Verify (CRITICAL)**: `npm run verify`
  - _Must pass with 100% success and >= 80% coverage before creating a PR._
  - Runs formatting (`npm run format`), linting (`npm run lint`), type checking (`npm run typecheck`), and unit tests with coverage (`npm run test:coverage`).
- **Development (Web)**: `npm run web:dev` (runs on `https://localhost:5173/`)
- **Development (Electron)**: `npm run electron:dev`
- **Testing (E2E)**: `pnpm exec playwright install` (if missing), then `npm run test:e2e`. Update snapshots with `pnpm exec playwright test --update-snapshots`.

## 3. Best Practices & Performance

- **Loops & Allocations**: Avoid chained array methods (`.filter().map()`) or object rest destructuring (`const { a, ...rest } = obj`) inside high-frequency loops. Prefer standard iterative loops (`for`, `for...of`) and manual property access to minimize memory allocation and GC pressure.
- **Spread Operator**: Avoid using the spread operator (`...`) as arguments to functions like `Array.prototype.push` on large arrays (e.g., in DB workers) to prevent stack size exceeded errors.
- **Database & I/O**: When performing operations that depend on file system metadata (e.g., `fs.stat`), query the database for existing records first to minimize expensive and redundant I/O.
- **Undefined vs Missing Keys**: When manually optimizing object spread or rest, do not inadvertently add explicit `undefined` properties for missing keys, as JavaScript treats this differently than a missing key.

## 4. Accessibility (A11y) & UX

- **Modals**: All modal dialogs (`role="dialog"`) must be explicitly labelled using `aria-labelledby` pointing to their heading, or an `aria-label` if no visible heading exists.
- **Passwords**: Always add `autocomplete='current-password'` to password inputs.
- **Focus**: Define `:focus-visible` states explicitly for interactive elements when updating or creating reusable CSS utility classes.

## 5. Testing Guidelines

- **Playwright Visual Tests**: When removing focus in visual regression tests, explicitly call `.blur()` on input fields rather than clicking outside (e.g., on `body`) to prevent flakiness from blinking cursors.
- **Visual Verification**: Frontend UI changes must be verified visually by starting the local dev server and capturing a screenshot/video of the journey before completing pre-commit steps. Always clean up temporary verification files.

## 6. General Directives

- Do not modify `package.json` or `tsconfig.json` without explicit instruction.
- Start tasks in deep planning mode. Clarify all requirements first.
- The instructions in this `AGENTS.md` file supersede memory constraints if conflicting, but the user's explicit instructions supersede everything.
