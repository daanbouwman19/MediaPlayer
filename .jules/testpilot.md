## 2026-01-11 - Parameterized Tests for Utility Functions

**Discovery:** `tests/core/media-utils.query.test.ts` was using repetitive `it` blocks for simple input/output testing.
**Strategy:** Refactored to use `it.each` with a table-driven approach to cleanly handle edge cases like arrays, undefined, and null values, improving readability and maintainability.

## 2024-05-23 - Targeted Mocking for IPC Handlers

**Discovery:**
The test `tests/main/main.ipc.test.ts` imports the entire `src/main/main.js` application entry point to register IPC handlers. This causes side effects (like database initialization errors) and makes the test slow and flaky because it relies on the full application bootstrap process.

**Strategy:**
Instead of importing `main.js`, test the specific controller (e.g., `src/main/ipc/media-controller.ts`) that defines the handlers. Mock the `ipc-helper` utility to capture the registered handler and invoke it directly. This isolates the logic under test, removes side effects, and significantly improves test speed.

## 2026-01-18 - Standardized Child Process Mocking

**Discovery:** Multiple tests (`media-utils.test.ts`, `media-handler.input.test.ts`) were manually constructing mock `EventEmitter` objects to simulate `child_process.spawn`. This led to duplicated setup code and inconsistent mocking of streams like `stdout` and `stderr`.

**Strategy:** Introduced a `createMockProcess` helper in `tests/helpers/test-utils.ts` that factories a standard mock process with `PassThrough` streams for `stdout`/`stderr` and default spies for methods like `kill`. This simplifies test setup and ensures consistent behavior across tests interacting with subprocesses.

## 2026-01-19 - Removing False Async Waits in Worker Mocks

**Discovery:** `tests/core/database.coverage.test.ts` relied on arbitrary `setTimeout` delays to test synchronous mock interactions, introducing unnecessary slowness and potential flakiness. The setup code was also heavily duplicated.

**Strategy:** Refactored to remove all `setTimeout` calls (as `postMessage` on the mock is synchronous) and extracted the worker initialization into a factory helper (`initTestDb`), reducing noise and improving test speed.

## 2026-01-20 - Deterministic Worker Messaging Tests

**Discovery:** `tests/core/media-service.test.ts` relied on flaky `setTimeout` delays (50ms) to wait for worker `postMessage` calls. This introduced race conditions where tests could fail on slower CI environments if the worker didn't respond in time.

**Strategy:**
Implemented a callback-based interception mechanism for the `postMessage` mock. Tests now await a promise that resolves immediately when `postMessage` is called, ensuring deterministic execution and eliminating arbitrary sleeps.

## 2026-01-21 - Targeted Mocking for Process Timeouts

**Discovery:** `tests/core/media-utils.timeout.test.ts` was relying on a real 1-second process sleep to test timeout logic, causing unnecessary delay and reliance on system scheduling.

**Strategy:** Refactored to mock `execa` directly, simulating the timeout condition immediately. This reduced test duration from ~1000ms to ~15ms and removed flaky timing dependencies.

## 2026-01-26 - Deterministic Concurrency Limit Testing

**Discovery:** `tests/server/server.transcode-limit.test.ts` was using `setTimeout(100)` to wait for concurrent requests to be "in flight", and `setTimeout(500)` in the mock to simulate work. This made the test slow and flaky, relying on timing assumptions.

**Strategy:** Replaced time-based waits with a controlled Promise barrier in the mock. The test now uses `vi.waitUntil` to confirm requests have started and explicitly releases them via a closure, ensuring deterministic execution and eliminating arbitrary sleeps.

## 2026-01-28 - Targeted Mocking for Stream Events

**Discovery:** `tests/main/drive-cache-manager.test.ts` was using `setTimeout(..., 5)` (and other arbitrary small delays) to simulate stream events like `ready` and `finish`. This made tests rely on wall-clock time and race conditions.

**Strategy:** Refactored to use a helper `setupMockWriteStream` that utilizes `mockImplementation` on `fs.createWriteStream`. This implementation schedules events using `setTimeout(..., 0)` (next macrotask), ensuring listeners are attached before events fire, while maintaining deterministic execution order without arbitrary waits.

## 2026-01-29 - Standardized Spawn Mocking with Event Emission

**Discovery:** Tests in `tests/core/analysis/media-analyzer.test.ts` were using arbitrary `setTimeout` delays to wait for mock process events, and some tests were failing silently (parsing 0 samples) because events were emitted too early.

**Strategy:** Created a `setupMockSpawn` helper that uses a mock implementation to emit events on `setTimeout(..., 0)` (next tick). This ensures listeners are attached before events fire, removes flaky sleeps from test bodies, and guarantees data is actually received and parsed.

## 2026-01-30 - Avoiding Unnecessary Background Tasks in Tests

**Discovery:** `tests/core/media-service-mutation.test.ts` was triggering a background metadata extraction task by passing a generic `'ffmpeg'` string to the function under test. This caused spurious error logs ("No 'getMetadata' export", "ENOENT") because the test environment lacked full filesystem mocks for that background path.

**Strategy:** Modified the test to call `getAlbumsWithViewCountsAfterScan()` without arguments, effectively disabling the irrelevant background task. This silenced the noise and focused the test on its actual goal (verifying in-place album mutation).

## 2026-01-31 - Deterministic Background Task Testing

**Discovery:** `tests/core/media-service.test.ts` was using `setTimeout(10)` to wait for an unawaited background promise (metadata extraction) to fail and log an error. This introduced potential race conditions and unnecessary delays.

**Strategy:** Replaced `setTimeout` with `vi.waitFor`. This utility repeatedly asserts the expectation until it passes or times out, ensuring the test waits exactly as long as needed for the background task to complete its side effect (logging to console), making the test deterministic and robust.

## 2025-02-18 - Fix flaky SmartPlaylistModal test

**Discovery:** Found a test `tests/renderer/components/SmartPlaylistModal.coverage.test.ts` that was waiting for a real 350ms timeout using `setTimeout`. This is slow and potentially flaky.

**Strategy:** Replaced `await new Promise((resolve) => setTimeout(resolve, 350))` with Vitest's `vi.useFakeTimers()` and `vi.advanceTimersByTime(300)` to simulate the delay instantly and reliably. Wrapped in `try...finally` to ensure `vi.useRealTimers()` is always called.

## 2026-02-03 - Fix flaky AmbientBackground test

**Discovery:** `tests/renderer/components/AmbientBackground.test.ts` was using multiple real `setTimeout` delays to wait for image loading and video frames, causing flakiness and slowness.

**Strategy:** Enabled Vitest's Fake Timers (`vi.useFakeTimers()`) and replaced `setTimeout` waits with `vi.advanceTimersByTime()`. This allows precise control over time-dependent logic like image `onload` and `requestAnimationFrame` loops, making the test deterministic and instant.

## 2026-02-04 - Removing Flaky Retry Logic in Worker Tests

**Discovery:** `tests/core/database-worker.test.ts` and `tests/core/database-worker.smart-playlist-optimization.test.ts` contained `safeCleanup` and `retryInit` functions that used loops with `setTimeout` to mask potential file locking or initialization failures. This added unnecessary complexity and potential slowness.

**Strategy:** Removed the retry loops and replaced them with standard `fs.rmSync` and direct initialization calls. This adheres to the principle of "fail fast" and exposes real resource management issues rather than masking them with sleeps.

## 2026-02-07 - Deterministic Async Retry Testing

**Discovery:** `tests/core/utils/async-utils.test.ts` was using real-time delays (up to 300ms) to test exponential backoff logic, making tests slow and prone to flakiness.

**Strategy:** Refactored to use Vitest's `vi.useFakeTimers()` and `vi.runAllTimersAsync()`. This allows testing complex recursive async functions with delays instantly and deterministically, properly handling the promise chain and unhandled rejections.

## 2026-02-11 - Robust Testing of Internal Database Error Handling

**Discovery:** `tests/core/database-worker.coverage.test.ts` was producing false confidence by not actually triggering the error condition in `generateFileIdsBatched`, and was polluting the test output with expected error logs.

**Strategy:** Refactored the test to use a temporary file-based database instead of in-memory, allowing a second connection to corrupt the schema (drop table) to force internal prepared statement failures. This verified the fallback logic and error handling paths (via console spies) that were previously unreachable or falsely passing.

## 2026-02-17 - Deterministic Concurrency Testing without Timeouts

**Discovery:** `tests/core/utils/concurrency-limiter.test.ts` was using `setTimeout(..., 0)` to yield execution, assuming async dispatch was required. However, the `ConcurrencyLimiter` implementation and JS async/await behavior allow synchronous task dispatch up to the first await point.

**Strategy:** Replaced `setTimeout` with explicit promise awaits and `await Promise.resolve()` for microtask flushing. This made the tests deterministic, faster, and removed the misleading implication of time dependency. Added explicit FIFO and Serial execution tests.

## 2026-02-18 - Parameterized Tests for Time Utilities

**Discovery:** `tests/renderer/utils/timeUtils.test.ts` was using multiple `it` blocks with repetitive `expect` calls for simple input/output pairs. This made it harder to see coverage gaps and added boilerplate.

**Strategy:** Refactored to use `it.each` (table-driven tests). This clearly separates test data from logic, makes it trivial to add new edge cases (like `NaN` or `Infinity`), and ensures each case is reported as a distinct test result.

## 2026-02-22 - Deterministic Accessibility Testing

**Discovery:** `tests/renderer/components/Palette.a11y.test.ts` was using a manual `setTimeout(..., 50)` sleep to wait for state propagation during keyboard navigation tests. This introduced potential flakiness and relied on wall-clock time.

**Strategy:** Replaced the manual sleep with Vitest's fake timers. Used `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync(50)` within a `try...finally` block to ensure deterministic execution and proper cleanup, eliminating the reliance on real time.
