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
npm run rebuild:electron # Rebuild native modules (e.g. ffmpeg-static) for Electron (not needed for node:sqlite)
npm run rebuild:node    # Rebuild native modules for Node/server mode
```

To run a single test file: `npx vp test run tests/path/to/file.test.ts`

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
├── core/        # Shared business logic (used by both Electron and server)
├── main/        # Electron main process (window lifecycle, IPC, Google Drive auth)
├── server/      # Express entry point, routes, middleware (web mode only)
├── renderer/    # Vue 3 UI (shared between modes)
├── preload/     # Electron preload script — IPC security bridge
└── shared/      # IPC channel names and type contracts
```

### Key architectural patterns

**Dual-mode API abstraction** — The renderer never calls Electron IPC or HTTP directly. `src/renderer/api/ElectronAdapter.ts` and `WebAdapter.ts` implement the same interface; the correct one is injected at runtime. This is the mechanism that lets the Vue UI work in both modes without branching.

**Core layer** — `src/core/` contains all business logic and is imported by both `src/main/` and `src/server/`. It does not import from either. Notable subsystems:

- `media-service.ts` / `media-handler.ts` — orchestrate scanning, streaming, and transcoding
- `hls-handler.ts` / `hls-manager.ts` — FFmpeg-based HLS transcoding and session management
- `database.ts` + `database-worker.ts` — Built-in SQLite (`node:sqlite`) with WAL mode; queries centralized in `repositories/media-repository.ts`
- `fs-provider.ts` / `fs-provider-factory.ts` — filesystem abstraction over local FS and Google Drive
- `access-validator.ts` — authorization layer; hot path uses LRU cache

**Vue state** lives in Pinia stores under `src/renderer/composables/`. Key stores: `useLibraryStore`, `usePlayerStore`, `useSlideshow`, `usePlaylistStore`.

### Test layout

Tests mirror the source tree under `tests/`. `vitest.config.ts` defines two projects: `node` for `tests/main/**`, `tests/server/**`, `tests/core/**` and `*.node.test.ts`, and `dom` (`happy-dom`) for everything else. Coverage thresholds are enforced **per file** at 80%.

### Native dependencies

This project utilizes Node's built-in `node:sqlite` module, which does not require native rebuilding, ensuring high compatibility between Electron and Node environments. `ffmpeg-static` is used for media transcoding.
