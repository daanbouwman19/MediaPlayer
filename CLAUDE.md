# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rule

Always run `npm run verify` before committing or creating a PR. This runs `vp check --fix` (format + lint, auto-fixing what it can), typecheck, and test coverage in sequence. CI enforces `npm run check` and requires 80% coverage per file — skipping verify will fail the build.

## Commands

```bash
npm run verify          # Format + lint + typecheck + test coverage (required before PR)
npm run check           # Format check + lint (what CI runs), no fixes
npm run electron:dev    # Electron desktop app (main + preload + renderer concurrently)
npm run web:dev         # Express server + Vue dev server
npm test                # Vitest unit/integration tests
npm run test:watch      # Vitest watch mode
npm run test:e2e        # Playwright end-to-end tests (starts web:dev as server)
npm run typecheck       # vue-tsc -b --noEmit
npm run electron:package # Build + package the desktop app with electron-builder
npm run web:build && npm run web:start  # Production web server (HTTPS, needs SESSION_SECRET)
```

To run a single test file: `npx vp test run tests/path/to/file.test.ts`. Update Playwright snapshots with `npx playwright test --update-snapshots`.

Builds are split by the `VITE_TARGET` env var (`main`, `preload`, `renderer`, `server`, `client`), each handled by its own branch in `vite.config.ts`. The web server reads `.env` (see `.env.example` for `HOST`, `SESSION_SECRET`, `GLOBAL_PASSWORD`, `SYSTEM_USER`/`SYSTEM_PASSWORD`, `ALLOWED_FS_ROOTS`, Google credentials, etc.).

Dependency install scripts must be approved in the `allowScripts` field of `package.json` (npm 12+ enforces this in CI). Approve a new one with `npm approve-scripts --no-allow-scripts-pin <package>`.

Tooling runs through [Vite+](https://viteplus.dev) (`vp`): `vp fmt` (Oxfmt), `vp lint` (Oxlint), `vp check` (both), `vp test` (Vitest), `vp build`/`vp dev` (Vite). Lint and format settings live in the `lint` and `fmt` blocks of `vite.config.ts`; test settings live in `vitest.config.ts`. Type checking uses `vue-tsc` (TypeScript 6), because TypeScript 7 cannot type-check `.vue` files yet; Dependabot skips TypeScript majors for that reason. Upgrade `vite-plus` together with its `vite`/`vitest` pins by running `npx --package=vite-plus@<version> vp migrate --no-interactive`.

### TypeScript strictness

`any` is banned in `src/`: lint enforces `no-explicit-any` and the type-aware `no-unsafe-*` rules, so untyped values (`JSON.parse`, `req.body`, worker messages) must be typed at the boundary — prefer `unknown` plus validation. Type-aware lint also rejects floating or misused promises: `await` them, add a `.catch`, or mark deliberate fire-and-forget calls with `void` when the callee handles its own errors. Tests may use `any` for mocks.

Every TS file is type-checked. `tsconfig.node.json` / `tsconfig.web.json` cover `src/` with `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride` and `noFallthroughCasesInSwitch`. `tsconfig.node.test.json` / `tsconfig.web.test.json` cover `tests/` with the same options except `noUncheckedIndexedAccess`.

## Architecture

This is a media library player with **two deployment modes sharing most code**:

- **Electron desktop app** — local playback, Google Drive integration, embedded Express server
- **Web server mode** — Express backend + Vue 3 frontend, accessed via browser

### Source layout

```
src/
├── core/           # Shared business logic: auth/, database/, media/, network/
├── infrastructure/ # Node-side adapters: fs-provider-factory, local/Drive providers, Google auth, FFmpeg/VLC helpers
├── main/        # Electron main process (window lifecycle, IPC, Google Drive auth)
├── server/      # Express entry point, routes, middleware (web mode only)
├── renderer/    # Vue 3 UI (shared between modes)
├── preload/     # Electron preload script — IPC security bridge
└── shared/      # IPC channel names and type contracts
```

### Key architectural patterns

**Dual-mode API abstraction** — The renderer never calls Electron IPC or HTTP directly. `src/renderer/api/ElectronAdapter.ts` and `WebAdapter.ts` implement the same interface; the correct one is injected at runtime. This is the mechanism that lets the Vue UI work in both modes without branching.

**Media is always served over HTTP**, even in Electron. `createMediaApp` in `src/core/media/media-handler.ts` builds the Express app for streaming, thumbnails, metadata and heatmaps (paths in `src/core/media/routes.ts`); Electron runs it via `src/main/local-server.ts`, and web mode mounts equivalent routes through `src/server/routes/`. Control operations (library, settings, auth) go over IPC in Electron and REST in web mode.

**Typed IPC** — channels and request/response types are declared per domain in `src/shared/ipc/*.contract.ts` and combined in `src/shared/ipc-contract.ts`. Main-process handlers in `src/main/ipc/*-controller.ts` register through `handleIpc` (`src/main/utils/ipc-helper.ts`), which is typed against that contract. Adding an operation means updating the contract, the controller, the preload bridge and `ElectronAdapter`, plus the matching server route and `WebAdapter` method.

**Core layer** — `src/core/` contains the business logic and is imported by both `src/main/` and `src/server/`; it does not import from either (it does use `src/infrastructure/`). Notable subsystems:

- `media/media-service.ts` / `media/media-handler.ts` — orchestrate scanning, streaming, and transcoding; scanning runs in `media/scan-worker.ts`
- `media/hls-handler.ts` / `media/hls-manager.ts` — FFmpeg-based HLS transcoding and session management
- `database/database.ts` + `database/database-worker.ts` — built-in SQLite (`node:sqlite`, WAL mode) running in a worker thread, reached through `worker-client.ts`; queries centralized in `database/repositories/media-repository.ts`
- `media/fs-provider.ts` + `infrastructure/fs-provider-factory.ts` — filesystem abstraction over local FS and Google Drive (`infrastructure/providers/`)
- `auth/access-validator.ts` — authorization layer; hot path uses an LRU cache

**Vue state** lives in Pinia stores under `src/renderer/composables/` (`useLibraryStore`, `usePlayerStore`, `usePlaylistStore`, `useAuthStore`, `useUIStore`); other composables there (e.g. `useSlideshow`) are plain composition functions. Feature UI is grouped under `src/renderer/features/` (`auth`, `library`, `player`).

### Test layout

Tests mirror the source tree under `tests/`. `vitest.config.ts` defines two projects: `node` for `tests/main/**`, `tests/server/**`, `tests/core/**` and `*.node.test.ts`, and `dom` (`happy-dom`) for everything else. Coverage thresholds are enforced **per file** at 80%. Shared test doubles live in `tests/fakes/` and `__mocks__/`. Transcoding tests use generated media (`npx tsx tests/utils/media-generator.ts`, output in `tests/fixtures/diversity`, git-ignored).

### Native dependencies

The database uses Node's built-in `node:sqlite`, so no native rebuild is needed between Electron and Node. `ffmpeg-static` provides the FFmpeg binary for transcoding (its install script downloads it). Requires Node >= 24 (README recommends 25).

## Conventions (from AGENTS.md)

- In hot loops (scanning, DB workers) prefer plain `for`/`for...of` over chained array methods or object rest/spread, and never spread large arrays into `push` (stack overflow). When hand-optimizing spreads, don't introduce explicit `undefined` keys where the original omitted the key.
- Query the database for existing records before doing `fs.stat`-style I/O.
- Modals (`role="dialog"`) need `aria-labelledby` or `aria-label`; password inputs need `autocomplete="current-password"`; reusable interactive CSS utilities need explicit `:focus-visible` styles.
- In Playwright visual tests, call `.blur()` on inputs instead of clicking elsewhere to remove focus.
- Verify UI changes visually against the running dev server, and clean up temporary verification files afterwards.
- Do not modify `package.json` or `tsconfig.json` without explicit instruction.
