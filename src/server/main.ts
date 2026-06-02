/**
 * @file Server entry point.
 */
import https from 'https';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import selfsigned from 'selfsigned';
import { createApp } from './app.ts';
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from '../core/media/constants.ts';
import { MediaService } from '../core/media/media-service.ts';
import { MediaRepository } from '../core/database/repositories/media-repository.ts';
import { NodeFileSystem } from '../infrastructure/node-file-system.ts';
import { WorkerScannerService } from '../infrastructure/worker-scanner-service.ts';
import { MediaDurationHandler } from '../infrastructure/media-duration-handler.ts';

const CERT_DIR = path.join(process.cwd(), 'certs');
const KEY_PATH = path.join(CERT_DIR, 'server.key');
const CERT_PATH = path.join(CERT_DIR, 'server.cert');

async function ensureCertificates() {
  try {
    await Promise.all([fs.access(KEY_PATH), fs.access(CERT_PATH)]);
    console.log('SSL Certificates found.');
  } catch (e: unknown) {
    const error = e as { code?: string };
    if (error.code !== 'ENOENT') {
      console.error(
        'An unexpected error occurred while checking for SSL certificates:',
        error,
      );
      throw error;
    }

    console.log('Generating SSL Certificates...');
    await fs.mkdir(CERT_DIR, { recursive: true });

    const attrs = [{ name: 'commonName', value: 'localhost' }];
    // @ts-expect-error - The types might be slightly off or options vary by version, but days is standard.
    const pems = await selfsigned.generate(attrs, { days: 365 });

    await fs.writeFile(CERT_PATH, pems.cert);
    await fs.writeFile(KEY_PATH, pems.private);

    console.log('SSL Certificates generated successfully.');
  }
}

export async function bootstrap() {
  await ensureCertificates();

  const mediaRepo = new MediaRepository();
  const fileSystem = new NodeFileSystem();
  const workerService = new WorkerScannerService();
  const mediaHandler = new MediaDurationHandler();
  const mediaService = new MediaService(
    mediaRepo,
    fileSystem,
    workerService,
    mediaHandler,
  );

  const app = await createApp(mediaService);
  const host = process.env.HOST || DEFAULT_SERVER_HOST;
  let port = DEFAULT_SERVER_PORT;

  if (process.env.PORT) {
    const parsedPort = parseInt(process.env.PORT, 10);
    if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      port = parsedPort;
    } else {
      console.warn(
        `Invalid PORT "${process.env.PORT}". Falling back to default: ${DEFAULT_SERVER_PORT}`,
      );
    }
  }

  const credentials = {
    key: await fs.readFile(KEY_PATH),
    cert: await fs.readFile(CERT_PATH),
  };

  const server = https.createServer(credentials, app);
  server.setTimeout(30000);

  server.listen(port, host, () => {
    console.log(`Server running at https://${host}:${port}`);
    console.log(
      `Environment: ${process.env.NODE_ENV !== 'production' ? 'Development' : 'Production'}`,
    );
  });
}

export function shouldAutoBootstrap(entryArg = process.argv[1]) {
  if (!entryArg) {
    return false;
  }

  const resolvedEntry = path.resolve(entryArg);
  try {
    const resolvedSelf = path.resolve(fileURLToPath(import.meta.url));
    if (resolvedEntry.toLowerCase() === resolvedSelf.toLowerCase()) {
      return true;
    }
  } catch {
    // Ignore invalid URLs in test environments.
  }

  return path.basename(entryArg) === 'main.ts';
}

if (shouldAutoBootstrap()) {
  bootstrap();
}
