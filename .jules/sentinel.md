# Sentinel Journal

## 2026-01-11 - Input Validation Improvement: Regex DOS Prevention

**Vulnerability:** The regex used to validate time formats in `src/core/media-utils.ts` (`/^(\d+:)+\d+(\.\d+)?$/`) was permissive, allowing an arbitrary number of colon-separated groups. While `(\d+:)+` followed by `\d+` does not inevitably lead to catastrophic backtracking due to the distinct separator, it is "bad code" that accepts invalid formats like `00:00:00:00:01` and could be stressful for regex engines with extremely long inputs.
**Learning:** Regex patterns allowing infinite repetition of groups (like `(a+)+` or `(group)+`) should be scrutinized for ReDoS risks. Even if safe from exponential backtracking, loose validation can lead to downstream issues (e.g., FFmpeg argument parsing) or resource exhaustion.
**Prevention:** Tighter validation was implemented using `^(?:\d+:){0,2}\d+(?:\.\d+)?$`. This explicitly limits the input to standard HH:MM:SS format (max 2 colons), rejecting malformed inputs early and safely.

## 2026-01-12 - Sensitive Environment File Protection

**Vulnerability:** The file system scanner could potentially index sensitive configuration files (like `.env`) if they were inside a media directory.
**Learning:** Blocklists should be applied at the file discovery layer, not just at the access layer.
**Prevention:** Added `.env` to the `SENSITIVE_SUBDIRECTORIES` set and enforced checks during file scanning.

## 2026-01-13 - Concurrent Transcoding DoS Protection

**Vulnerability:** The `/api/stream` endpoint with `transcode=true` spawned unlimited FFmpeg processes.
**Learning:** `supertest` requests are lazy Thenables. When testing concurrency, you must explicitly call `.then()` to start the request; otherwise, `Promise.all` starts them sequentially or too late relative to the assertion.
**Prevention:** Implemented `MAX_CONCURRENT_TRANSCODES` semaphore in `src/server/server.ts` to limit active transcoding sessions to 3.

## 2026-01-15 - Cached Thumbnail IDOR

**Vulnerability:** Cached thumbnails were served based solely on the file path hash, checking for cache existence before validating if the user still had access to the original file. This allowed access to thumbnails of files that were subsequently restricted or removed from allowed directories.
**Learning:** Caching layers must enforce the same access controls as the primary data source. "Cache hit" logic should not bypass authorization checks.
**Prevention:** Moved `validateFileAccess` to the beginning of `serveThumbnail` in `src/core/thumbnail-handler.ts`, ensuring access is verified before checking the cache.

## 2025-01-20 - Sensitive Directory Root Protection

**Vulnerability:** An attacker could bypass sensitive file protections by adding the sensitive directory itself (e.g., `~/.ssh`) as a media source. The existing check only validated files _relative_ to the media source root, missing the root directory itself.
**Learning:** Validation logic must check the _entire_ path chain, including the root anchor, not just the segments below it.
**Prevention:** Updated `isSensitiveDirectory` to explicitly check if the target directory or any of its segments match the `SENSITIVE_SUBDIRECTORIES` blocklist.

## 2026-01-17 - Database Exposure and Case-Insensitive Bypass

**Vulnerability:** Access to the database file (`media-library.db`) and sensitive directories (like `node_modules`) was possible. The database file was not in the blocklist, allowing download if the app root was added as a source. Directory protection was bypassable on case-insensitive file systems (e.g., accessing `NODE_MODULES` on Windows).
**Learning:** File system security checks must account for platform-specific case sensitivity. Explicitly identifying and blocking critical application artifacts (like databases) is essential when user-controlled paths can overlap with application paths.
**Prevention:** Added database filenames and lockfiles to the blocklist. Updated `authorizeFilePath` to perform case-insensitive checks against the sensitive directory list.

## 2026-01-24 - Critical Environment File Exposure

**Vulnerability:** Files like `.npmrc` (containing auth tokens), `docker-compose.yml`, and shell history files were accessible via the API if located within an allowed media directory. The `SENSITIVE_SUBDIRECTORIES` blocklist was incomplete.
**Learning:** Default blocklists for sensitive files must be comprehensive and include development artifacts (Docker, NPM config) and system history files, not just common secrets like `.env` or `.ssh`. Attackers look for these specific files for credentials.
**Prevention:** Expanded `SENSITIVE_SUBDIRECTORIES` to include `.npmrc`, `.docker`, `docker-compose.yml`, `.bash_history` and other critical files.

## 2026-01-25 - Critical System and Credential File Exposure

**Vulnerability:** Despite previous protections, critical system files (`server.key`, `.bashrc`, `.zshrc`, `id_rsa`, `.htpasswd`) remained accessible if located within an allowed media directory. The blocklist was missing these specific high-value targets.
**Learning:** Security blocklists must be exhaustive and cover not just development artifacts but also system administration credentials (SSH keys, SSL keys) and user profile configurations which often contain exported secrets.
**Prevention:** Expanded `SENSITIVE_SUBDIRECTORIES` to include `server.key` (SSL private key), shell configuration files (`.bashrc`, `.profile`), SSH private keys (`id_rsa`, etc.), and other credential stores.

## 2026-01-26 - Unbounded HLS Transcoding DoS

**Vulnerability:** The HLS streaming endpoint (`/api/hls/playlist.m3u8`) allowed creating unlimited HLS transcoding sessions. Each request for a unique file initiated a new FFmpeg process via `HlsManager`, bypassing the existing `MAX_CONCURRENT_TRANSCODES` limit in `server.ts` (which only applied to direct streams).
**Learning:** Security limits (like concurrency caps) must be enforced at the service layer (`HlsManager`) rather than just the controller layer (`server.ts`) to ensure all access paths respect the limits. Singleton managers need internal resource accounting.
**Prevention:** Enforced `MAX_CONCURRENT_TRANSCODES` check inside `HlsManager.ensureSession()` to block excessive concurrent HLS transcoding tasks.

## 2026-02-01 - Inconsistent Sensitive File Visibility

**Vulnerability:** `listDirectory` in `src/core/file-system.ts` used a static copy of the sensitive files list, ignoring runtime additions (like the database file) made via `registerSensitiveFile`. This allowed sensitive files to be visible in directory listings.
**Learning:** Security controls based on mutable blocklists must share a single source of truth. Static initialization in consumers leads to stale security rules.
**Prevention:** Centralized the sensitive filename check in `src/core/security.ts` and updated consumers to use this shared, dynamic check.

## 2026-01-29 - Recursive Scanning of Sensitive Directories

**Vulnerability:** The `media-scanner.ts` descended recursively into all subdirectories, including sensitive ones like `.ssh`, `.git`, and `node_modules`, if they were contained within an allowed media root. This could expose media files hidden in sensitive directories and waste resources.
**Learning:** Access controls and blocklists must be enforced at every layer of recursion, not just at the entry point. Security checks in file listing APIs (`listDirectory`) do not automatically apply to internal scanning logic.
**Prevention:** Updated `processDirectoryEntries` in `src/core/media-scanner.ts` to skip directories that start with `.` or match `isSensitiveFilename` before descending.

## 2026-01-30 - Hidden Directory Traversal

**Vulnerability:** The application allowed listing and accessing files within arbitrary hidden directories (e.g., .vscode, .config) because the security check only blocked a specific list of sensitive filenames.
**Learning:** Blacklisting sensitive directories is insufficient. Hidden directories (starting with .) should be treated as sensitive by default in a media application context.
**Prevention:** Block all path segments starting with '.' in security validation logic.

## 2026-01-31 - Unbounded Path Length DoS

**Vulnerability:** The `authorizeFilePath` function lacked input length validation, allowing attackers to submit excessively long paths (e.g., 10MB strings). This could lead to CPU exhaustion or ReDoS when processing regexes or filesystem operations on these inputs.
**Learning:** Security validation must occur before any complex processing. Input constraints (like length limits) should be enforced as early as possible, especially for inputs that are used in system calls or regex matching.
**Prevention:** Enforced a `MAX_PATH_LENGTH` of 4096 characters in `validateInput`, rejecting oversized inputs immediately before they reach filesystem layers.

## 2026-02-01 - Drive File Authorization Bypass

**Vulnerability:** The `generateFileUrl` function in `media-handler.ts` bypassed the `authorizeFilePath` security check for paths starting with the Google Drive protocol (`gdrive://`). This allowed unauthorized access to Google Drive files if the attacker knew the file ID, bypassing the restriction that only imported media should be accessible.
**Learning:** Security checks should be uniform and not contain exceptions for specific protocols or file types unless explicitly justified and secured. Helper functions like `generateFileUrl` that are exposed to IPC/API must enforce the same security boundaries as direct API endpoints.
**Prevention:** Removed the conditional check that skipped authorization for drive paths. Now `authorizeFilePath` is called for all files, which internally delegates to `authorizeVirtualPath` for protocol-specific validation against the allowed media library.

## 2026-02-02 - Critical User Data Protection

**Vulnerability:** The application's sensitive file blocklist (`SENSITIVE_SUBDIRECTORIES`) missed critical user data directories on Windows (`AppData`) and macOS (`Library`), as well as Windows registry hives (`NTUSER.DAT`). This left potential exposure of browser cookies, passwords, and system configurations if a user added their home directory as a media source.
**Learning:** Default blocklists must account for OS-specific user data structures. "Hidden" files (starting with `.`) are not the only sensitive targets; major OSes use non-hidden folders like `AppData` and `Library` for sensitive data storage.
**Prevention:** Expanded `SENSITIVE_SUBDIRECTORIES` to explicitly block `AppData`, `Library`, `NTUSER.DAT`, `Autorun.inf`, and boot configuration files.

## 2026-02-03 - Inconsistent Sensitive File Detection

**Vulnerability:** The `isHiddenOrSensitive` check accessed the `sensitiveSubdirectoriesSet` directly, bypassing the enhanced logic in `isSensitiveFilename`. This caused files like `id_rsa.bak` (which were not in the set but were caught by `isSensitiveFilename`) to be allowed if they didn't start with a dot.
**Learning:** Duplicate security logic leads to bypasses. When logic is enhanced in one place (`isSensitiveFilename`), all consumers must use that function instead of re-implementing the check or accessing underlying data structures directly.
**Prevention:** Refactored `isHiddenOrSensitive` to call `isSensitiveFilename`, ensuring consistent enforcement of all sensitivity rules including prefix/suffix checks.

## 2026-02-04 - Inconsistent Path Validation in System Routes

**Vulnerability:** `POST /api/directories` and other system routes implemented custom validation logic that missed critical checks (like `MAX_PATH_LENGTH`) enforced in `authorizeFilePath`. This allowed potential DoS via large inputs.
**Learning:** Re-implementing validation logic instead of reusing a centralized validator leads to inconsistencies and gaps.
**Prevention:** Exported and reused `validateInput` from `security.ts` across all routes handling file paths.

## 2026-02-06 - Drive Authorization Bypass (IDOR) Fix

**Vulnerability:** The application blindly authorized any file path starting with `gdrive://` via a bypass in `validateFileAccess`. This allowed attackers to access any file in the connected Google Drive by guessing its ID, bypassing the intended restriction to specific "Media Directories".
**Learning:** Bypass checks based on protocol/scheme (e.g. `if (isDrivePath)`) are dangerous if the underlying authorization logic (`authorizeFilePath`) relies on path hierarchy that doesn't exist for that protocol (flat IDs vs folders). Always enforce a positive authorization model (allowlist) for external resources where hierarchy cannot be trusted or verified easily.
**Prevention:** Removed the bypass. Implemented strict authorization by requiring Drive files to be present in the scanned media library (`media_metadata` table). Updated the scanner logic (`cacheAlbums`) to ensure all valid Drive files are indexed into this table during scans.

## 2026-02-10 - Unauthenticated Local Media Proxy Exposure

**Vulnerability:** The `InternalMediaProxy` service, used for streaming Google Drive files to FFmpeg, started an HTTP server on `127.0.0.1` that accepted any request to `/stream/:fileId`. This allowed any local process to access any Google Drive file by ID without authentication, bypassing application access controls.
**Learning:** Internal services bound to localhost are not automatically secure. Any process on the user's machine can access them. Sensitive internal APIs must always require authentication (e.g., a shared secret or token) even when listening on loopback interfaces.
**Prevention:** Implemented a random 32-byte `authToken` generated at proxy startup. Required this token to be present in the `token` query parameter for all requests to the proxy. Updated `getUrlForFile` to sign the generated URLs with this token.

## 2026-02-11 - Missing IPC Path Validation

**Vulnerability:** The `MEDIA_EXTRACT_METADATA` IPC handler accepted an array of file paths and passed them directly to `extractAndSaveMetadata` without validation. This allowed an attacker (renderer process) to probe for file existence and extract metadata (duration) of any file on the system, bypassing the allowed media directories restriction.
**Learning:** In Electron apps, IPC handlers are the security boundary. Services often assume trusted input. Explicit validation must happen at the IPC layer.
**Prevention:** Always apply `filterAuthorizedPaths` (for arrays) or `validatePathAccess` (for single paths) in every IPC handler that accepts file paths.

## 2026-02-12 - Argument Injection in VLC Player

**Vulnerability:** The `openMediaInVlc` function passed the user-controlled file path directly to `child_process.spawn`. If a user (or attacker) named a file with a leading dash (e.g., `--plugin-path=...`), VLC could interpret it as a command-line option, potentially leading to arbitrary plugin loading or other unintended behavior (Argument Injection).
**Learning:** When spawning external processes with user-controlled arguments, relying on array-based `spawn` is not enough if the target program parses flags indiscriminately. Using the standard end-of-options delimiter `--` is critical to ensure subsequent arguments are treated as positional arguments (filenames) rather than flags.
**Prevention:** Updated `src/core/vlc-player.ts` to prepend `--` to the argument list passed to `spawn` (e.g., `vlc -- <filename>`).

## 2026-02-13 - Authorization Code Interception (PKCE)

**Vulnerability:** The Google OAuth callback implementation used `window.opener.postMessage(..., '*')` to return the authorization code to the application window. This could allow any malicious website that can convince a user to open the callback URL (or an attacker who can iframe it, though X-Frame-Options usually prevents that) to intercept the authorization code. In the context of Electron apps using `file://` or varying origins, securing `postMessage` target origin is difficult.
**Learning:** Relying on `postMessage` target origin for security in complex environments (like Electron with local servers) is fragile. Implementing PKCE (Proof Key for Code Exchange) moves the security assurance from the transport channel (origin checks) to the backend logic (verifier validation). Even if the code is intercepted, it is useless without the `code_verifier` which never leaves the backend.
**Prevention:** Implemented PKCE in the OAuth flow. `generateAuthUrl` now generates and stores a `code_verifier` and sends a `code_challenge`. `authenticateWithCode` requires and validates the `code_verifier` during token exchange.

## 2026-02-14 - [Unauthenticated Filesystem Access]

**Vulnerability:** The application exposes `/api/fs/ls` and `/api/directories` endpoints without authentication. This allows any network user to list server directories and add arbitrary directories (like `/home/user`) to the media library, potentially exposing sensitive user files.
**Learning:** Local-first applications that also offer "Server Mode" often lack proper authentication boundaries by default, assuming a trusted network.
**Prevention:** Implement mandatory authentication for all administrative actions (like adding media sources) and restrict filesystem browsing to predefined safe roots.

## 2026-02-15 - Missing Authentication on Web Server

**Vulnerability:** The application exposes a full REST API for file system and media management without any authentication when running in "Web Server" mode. This allows unauthenticated remote code execution (via directory manipulation) and information disclosure.
**Learning:** Even "local" web servers need authentication if they expose sensitive system operations. The assumption that "local network" implies trust is dangerous.
**Prevention:** Added optional Basic Authentication middleware. Future architectural changes should enforce authentication by default or separate "local" (electron) and "remote" (web) APIs more strictly.

## 2026-02-18 - Basic Auth DoS Mitigation

**Vulnerability:** The basic authentication middleware was using `scryptSync` (a slow KDF) to derive keys for `SYSTEM_USER` and `SYSTEM_PASSWORD` on _every_ request. This created a significant Denial of Service (DoS) vector where an attacker could flood the server with requests, causing high CPU usage and unresponsiveness.
**Learning:** While `scrypt` is excellent for password storage (hashing), it should not be used for per-request authentication checks unless there is strict rate limiting or caching. Using it for _input_ validation (deriving a key from the incoming password) on every request allows an attacker to force the server to perform expensive computations.
**Prevention:**

1.  **Cache static keys:** Derive keys for static credentials (like environment variables) once and cache them.
2.  **Use appropriate algorithms:** For comparing in-memory credentials (where the "hash" is not stored permanently), use a faster but still secure method like HMAC-SHA256 with a per-process random salt. This prevents timing attacks (via `timingSafeEqual`) without the massive CPU cost of `scrypt`.

## 2026-02-19 - Encrypted Token Storage

**Vulnerability:** Google OAuth tokens were stored in plain text in the `media-library.db` database. If an attacker gained access to the database file (e.g. via backup or local access), they could steal the refresh tokens and access the user's Google Drive data.
**Learning:** Sensitive credentials should never be stored in plain text, even in local databases. In shared environments (like Electron + Node Server), relying on OS-specific secure storage (Keychain) is difficult. A robust fallback (like application-level encryption with a generated key) is better than plain text.
**Prevention:** Implemented AES-256-GCM encryption for token storage. The master key is either provided via environment variable or generated securely and stored in a restricted `master.key` file, which is explicitly blocked from application file access APIs.

## 2026-02-20 - Arbitrary File Read via Directory Authorization

**Vulnerability:** The application authorized access to ANY file located within a user-added "Media Directory". While sensitive system files were blocked, users could add directories containing other sensitive non-media files (e.g., `passwords.txt`, source code) and then download them via the `/api/serve` endpoint, bypassing the intended limitation to media files.
**Learning:** Directory-based authorization is insufficient for applications that only intend to serve specific content types. A "Media Player" should not become a generic "File Server" for everything in a folder. Access controls must be specific to the resource type being accessed.
**Prevention:** Updated `authorizeFilePath` to strictly enforce an extension allowlist (`ALL_SUPPORTED_EXTENSIONS_SET`). This ensures that only supported media files can be downloaded, even if they reside in an authorized directory.
