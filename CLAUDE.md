# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical Rule

Always run `npm run verify` before committing or creating a PR. This runs format (auto-fix), lint, typecheck, and test coverage in sequence. CI enforces `npm run format:check` and requires 80% coverage per file — skipping verify will fail the build.

## Commands

```bash
npm run verify          # Format + lint + typecheck + test coverage (required before PR)
npm run electron:dev    # Electron desktop app (main + preload + renderer concurrently)
npm run web:dev         # Express server + Vue dev server
npm test                # Vitest unit/integration tests
npm run test:watch      # Vitest watch mode
npm run test:e2e        # Playwright end-to-end tests (starts web:dev as server)
npm run rebuild:electron # Rebuild native modules (better-sqlite3) for Electron
npm run rebuild:node    # Rebuild native modules for Node/server mode
```

To run a single test file: `npx vitest run tests/path/to/file.test.ts`

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
- `database.ts` + `database-worker.ts` — SQLite (better-sqlite3) with WAL mode; queries centralized in `repositories/media-repository.ts`
- `fs-provider.ts` / `fs-provider-factory.ts` — filesystem abstraction over local FS and Google Drive
- `access-validator.ts` — authorization layer; hot path uses LRU cache

**Vue state** lives in composables under `src/renderer/composables/` (no Pinia/Vuex). Key stores: `useLibraryStore`, `usePlayerStore`, `useSlideshow`, `usePlaylistStore`.

### Test layout

Tests mirror the source tree under `tests/`. Vitest uses `happy-dom` for renderer tests and `node` environment for `tests/main/**`, `tests/server/**`, and `tests/core/**`. Coverage thresholds are enforced **per file** at 80%.

### Native dependencies

`better-sqlite3` and `ffmpeg-static` are native modules. After changing Node/Electron versions, run the appropriate `rebuild:*` command.
