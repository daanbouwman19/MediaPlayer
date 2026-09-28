/**
 * @file Manages database interactions for the Electron main process.
 * Wraps the core database logic and handles worker path resolution specific to Electron.
 */

import path from 'path';
import { app, dialog } from 'electron';
import { fileURLToPath } from 'url';
import { initDatabase as initCoreDatabase } from '../core/database/database';
import { WorkerFactory } from '../core/database/worker-factory.ts';

/**
 * Tells the user that the database worker crashed and could not be
 * restarted: library data (sources, ratings, playlists) can no longer be read
 * or saved until the app is restarted.
 */
export function reportDatabaseUnavailable(error: Error): void {
  dialog.showErrorBox(
    'Media library unavailable',
    `The media library database stopped working and could not be restarted. Changes are not saved until you restart MediaPlayer.

${error.message}`,
  );
}

/**
 * Initializes the database by creating and managing a worker thread.
 * If an existing worker is present, it will be terminated and a new one started.
 * @returns A promise that resolves when the database is successfully initialized.
 * @throws {Error} If the worker initialization fails.
 */
export async function initDatabase(): Promise<void> {
  const dbPath = path.join(
    app.getPath('userData'),
    'media_slideshow_stats.sqlite',
  );

  const isTest =
    process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const { path: workerPath } = await WorkerFactory.getWorkerPath(
    'database-worker',
    {
      isElectron: true,
      isPackaged: app.isPackaged,
      isTest,
      currentDirname: __dirname,
      currentUrl: import.meta.url,
      electronAppPath: app.getAppPath ? app.getAppPath() : undefined,
    },
  );

  return initCoreDatabase(dbPath, workerPath, undefined, {
    onUnavailable: reportDatabaseUnavailable,
  });
}
