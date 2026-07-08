/**
 * @file Database schema definitions and versioned migrations.
 *
 * The schema is managed through sequential migrations driven by
 * `PRAGMA user_version`. Each entry in {@link MIGRATIONS} upgrades the
 * database by exactly one version inside a transaction. Fresh databases
 * (user_version = 0) run every migration; databases created before
 * versioning existed are brought onto the versioned track by the v1
 * baseline migration, which is idempotent against the legacy schema.
 */

import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import path from 'path';

/** Job type used by the transcode queue in the generic `jobs` table. */
export const JOB_TYPE_TRANSCODE = 'transcode';

/** Segment type for watched-progress ranges in `media_segments`. */
export const SEGMENT_TYPE_WATCHED = 'watched';

/**
 * Legacy table definitions as they existed before versioned migrations.
 * Used only by the v1 baseline migration; later migrations transform
 * these tables into their final shape.
 */
const LEGACY_SCHEMA = {
  MEDIA_VIEWS: `CREATE TABLE IF NOT EXISTS media_views (
    file_path_hash TEXT PRIMARY KEY,
    file_path TEXT UNIQUE,
    view_count INTEGER DEFAULT 0,
    last_viewed TEXT
  )`,

  APP_CACHE: `CREATE TABLE IF NOT EXISTS app_cache (
    cache_key TEXT PRIMARY KEY,
    cache_value TEXT,
    last_updated TEXT
  )`,

  MEDIA_DIRECTORIES: `CREATE TABLE IF NOT EXISTS media_directories (
    id TEXT PRIMARY KEY,
    path TEXT UNIQUE,
    type TEXT DEFAULT 'local',
    name TEXT,
    is_active INTEGER DEFAULT 1
  )`,

  MEDIA_METADATA: `CREATE TABLE IF NOT EXISTS media_metadata (
    file_path_hash TEXT PRIMARY KEY,
    file_path TEXT,
    duration REAL,
    size INTEGER,
    created_at TEXT,
    rating INTEGER DEFAULT 0,
    extraction_status TEXT DEFAULT 'pending',
    watched_segments TEXT,
    playback_position REAL DEFAULT 0
  )`,

  SMART_PLAYLISTS: `CREATE TABLE IF NOT EXISTS smart_playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    criteria TEXT NOT NULL,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  )`,

  SETTINGS: `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT
  )`,

  TRANSCODE_JOBS: `CREATE TABLE IF NOT EXISTS transcode_jobs (
    file_path TEXT PRIMARY KEY,
    file_path_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`,
};

/**
 * Indexes for the current (latest) schema. Created after migrations run;
 * every statement is idempotent.
 */
export const DB_INDEXES = {
  MEDIA_METADATA_IDX_STATUS: `CREATE INDEX IF NOT EXISTS idx_media_metadata_status ON media_metadata(extraction_status)`,
  MEDIA_METADATA_IDX_FILE_PATH: `CREATE INDEX IF NOT EXISTS idx_media_metadata_file_path ON media_metadata(file_path)`,
  MEDIA_METADATA_IDX_LAST_VIEWED: `CREATE INDEX IF NOT EXISTS idx_media_metadata_last_viewed ON media_metadata(last_viewed DESC)`,
  MEDIA_SEGMENTS_IDX_FILE: `CREATE INDEX IF NOT EXISTS idx_media_segments_file ON media_segments(file_path_hash, type)`,
  JOBS_IDX_STATUS: `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(type, status)`,
};

/**
 * Reads the current schema version from the database.
 */
export function getUserVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as
    { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * Creates database indexes for the latest schema.
 * Should be called after migrations have run.
 */
export function createIndexes(db: DatabaseSync): void {
  for (const index of Object.values(DB_INDEXES)) {
    try {
      db.prepare(index).run();
    } catch (error) {
      console.warn('[worker] Failed to create index (ignoring):', error);
    }
  }
}

/**
 * v0 -> v1: Baseline.
 *
 * Creates the legacy schema for fresh databases and applies the historic
 * ad-hoc migrations for databases that predate versioning (media_directories
 * id column, media_metadata column additions). Idempotent.
 */
export function migrateV1Baseline(db: DatabaseSync): void {
  for (const schema of Object.values(LEGACY_SCHEMA)) {
    db.prepare(schema).run();
  }
  legacyMigrateMediaDirectories(db);
  legacyMigrateMediaMetadata(db);
}

/**
 * v1 -> v2: Merge media_views into media_metadata.
 *
 * Adds view_count/last_viewed columns and an in_library flag that marks rows
 * indexed by a library scan (previously implied by presence in media_metadata
 * with a non-null path), then copies view stats over and drops media_views.
 */
export function migrateV2MergeMediaViews(db: DatabaseSync): void {
  db.exec(`ALTER TABLE media_metadata ADD COLUMN view_count INTEGER DEFAULT 0`);
  db.exec(`ALTER TABLE media_metadata ADD COLUMN last_viewed TEXT`);
  db.exec(`ALTER TABLE media_metadata ADD COLUMN in_library INTEGER DEFAULT 0`);

  // Rows with a file path were written by the scan/index pipeline.
  db.exec(
    `UPDATE media_metadata SET in_library = 1 WHERE file_path IS NOT NULL`,
  );

  db.exec(`UPDATE media_metadata SET
    view_count = COALESCE((SELECT v.view_count FROM media_views v WHERE v.file_path_hash = media_metadata.file_path_hash), 0),
    last_viewed = (SELECT v.last_viewed FROM media_views v WHERE v.file_path_hash = media_metadata.file_path_hash)
    WHERE file_path_hash IN (SELECT file_path_hash FROM media_views)`);

  // Views recorded for files that never made it into media_metadata
  // ("ghosts") keep their stats but are not marked as library members.
  db.exec(`INSERT INTO media_metadata (file_path_hash, file_path, view_count, last_viewed, in_library)
    SELECT v.file_path_hash, v.file_path, v.view_count, v.last_viewed, 0
    FROM media_views v
    WHERE v.file_path_hash NOT IN (SELECT file_path_hash FROM media_metadata)`);

  db.exec('DROP TABLE media_views');
}

/**
 * v2 -> v3: Move watched segments into a normalized media_segments table.
 *
 * The table is typed so future range-like data (scene markers, skip ranges)
 * can share the same model. Existing watched_segments JSON blobs are parsed
 * into rows; unparseable blobs are skipped.
 */
export function migrateV3MediaSegments(db: DatabaseSync): void {
  db.exec(`CREATE TABLE media_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path_hash TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT '${SEGMENT_TYPE_WATCHED}',
    start_time REAL NOT NULL,
    end_time REAL,
    label TEXT
  )`);

  const rows = db
    .prepare(
      `SELECT file_path_hash, watched_segments FROM media_metadata WHERE watched_segments IS NOT NULL`,
    )
    .all() as { file_path_hash: string; watched_segments: string }[];

  const insert = db.prepare(
    `INSERT INTO media_segments (file_path_hash, type, start_time, end_time) VALUES (?, '${SEGMENT_TYPE_WATCHED}', ?, ?)`,
  );

  for (const row of rows) {
    let segments: unknown;
    try {
      segments = JSON.parse(row.watched_segments);
    } catch {
      console.warn(
        `[worker] Skipping invalid watched_segments JSON for ${row.file_path_hash}`,
      );
      continue;
    }
    if (!Array.isArray(segments)) continue;
    for (const seg of segments) {
      const s = seg as { start?: unknown; end?: unknown };
      if (s && typeof s.start === 'number') {
        insert.run(
          row.file_path_hash,
          s.start,
          typeof s.end === 'number' ? s.end : null,
        );
      }
    }
  }

  db.exec('ALTER TABLE media_metadata DROP COLUMN watched_segments');
}

/**
 * v3 -> v4: Generalize transcode_jobs into a typed jobs table.
 *
 * Background work (transcoding today; thumbnails, previews, hashing later)
 * shares one pending/processing/done model keyed on (type, file_path).
 */
export function migrateV4JobsTable(db: DatabaseSync): void {
  db.exec(`CREATE TABLE jobs (
    type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_path_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (type, file_path)
  )`);

  db.exec(`INSERT INTO jobs (type, file_path, file_path_hash, status, error, created_at, updated_at)
    SELECT '${JOB_TYPE_TRANSCODE}', file_path, file_path_hash, status, error, created_at, updated_at
    FROM transcode_jobs`);

  db.exec('DROP TABLE transcode_jobs');
}

/**
 * Ordered migration steps. MIGRATIONS[n] upgrades version n to n + 1.
 */
const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  migrateV1Baseline,
  migrateV2MergeMediaViews,
  migrateV3MediaSegments,
  migrateV4JobsTable,
];

export const LATEST_DB_VERSION = MIGRATIONS.length;

/**
 * Brings the database up to the latest schema version and ensures indexes.
 * Each pending migration runs inside its own transaction; a failure rolls
 * back that step and aborts initialization.
 */
export function initializeDatabase(db: DatabaseSync): void {
  const currentVersion = getUserVersion(db);

  if (currentVersion > LATEST_DB_VERSION) {
    console.warn(
      `[worker] Database version ${currentVersion} is newer than supported version ${LATEST_DB_VERSION}; skipping migrations.`,
    );
    createIndexes(db);
    return;
  }

  for (let version = currentVersion; version < LATEST_DB_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    db.exec('BEGIN');
    try {
      migrate(db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackErr) {
        console.error('[worker] Failed to rollback migration:', rollbackErr);
      }
      throw e;
    }
    console.log(`[worker] Database migrated to version ${version + 1}`);
  }

  createIndexes(db);
}

/**
 * Legacy migration: rebuilds media_directories when the pre-2024 shape
 * (no id column) is detected. Part of the v1 baseline.
 */
function legacyMigrateMediaDirectories(db: DatabaseSync): void {
  const dirTableInfo = db
    .prepare('PRAGMA table_info(media_directories)')
    .all() as { name: string }[];
  const hasId = dirTableInfo.some((col) => col.name === 'id');
  const tableExists = dirTableInfo.length > 0;

  // If the table exists but has no 'id' column, it's the old schema and needs
  // a rebuild. (A freshly created table always has the new shape.)
  if (tableExists && !hasId) {
    console.log('[worker] Migrating media_directories table...');

    db.prepare(
      'ALTER TABLE media_directories RENAME TO media_directories_old',
    ).run();
    db.prepare(LEGACY_SCHEMA.MEDIA_DIRECTORIES).run();

    const oldRows = db
      .prepare('SELECT path, is_active FROM media_directories_old')
      .all() as { path: string; is_active: number }[];
    const insertStmt = db.prepare(
      'INSERT INTO media_directories (id, path, type, name, is_active) VALUES (?, ?, ?, ?, ?)',
    );

    for (const row of oldRows) {
      const id = crypto.randomUUID();
      const name = path.basename(row.path) || row.path;
      insertStmt.run(id, row.path, 'local', name, row.is_active);
    }

    db.prepare('DROP TABLE media_directories_old').run();
    console.log('[worker] Migration complete.');
  }
}

/**
 * Legacy migration: adds columns that were introduced over time to
 * media_metadata. Part of the v1 baseline.
 */
function legacyMigrateMediaMetadata(db: DatabaseSync): void {
  const tableInfo = db.prepare('PRAGMA table_info(media_metadata)').all() as {
    name: string;
  }[];

  const columns = new Set(tableInfo.map((col) => col.name));

  const additions = [
    { name: 'file_path', type: 'TEXT' },
    { name: 'size', type: 'INTEGER' },
    { name: 'created_at', type: 'TEXT' },
    { name: 'rating', type: 'INTEGER DEFAULT 0' },
    { name: 'extraction_status', type: "TEXT DEFAULT 'pending'" },
    { name: 'watched_segments', type: 'TEXT' },
    { name: 'playback_position', type: 'REAL DEFAULT 0' },
  ];

  for (const col of additions) {
    if (!columns.has(col.name)) {
      console.log(
        `[worker] Adding missing column ${col.name} to media_metadata...`,
      );
      db.prepare(
        `ALTER TABLE media_metadata ADD COLUMN ${col.name} ${col.type}`,
      ).run();
    }
  }
}
