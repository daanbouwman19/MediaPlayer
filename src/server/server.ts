/**
 * @file Legacy server entry (re-exported).
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.ts';
import { bootstrap } from './main.ts';

export { createApp, bootstrap };

const entryArg = process.argv[1];
const resolvedEntry = entryArg ? path.resolve(entryArg) : '';
const resolvedSelf = fileURLToPath(import.meta.url);
const isEntryFile = entryArg
  ? resolvedEntry.toLowerCase() === resolvedSelf.toLowerCase() ||
    path.basename(entryArg) === 'server.ts'
  : false;

if (isEntryFile) {
  bootstrap().catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
