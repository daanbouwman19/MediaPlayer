/**
 * @file Server entry point.
 */
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApp } from './app.ts';
import { installServerLifecycle } from './lifecycle.ts';
import {
  CERT_RENEWAL_CHECK_INTERVAL_MS,
  ensureCertificates,
  resolveCertDir,
} from './certificates.ts';
import { getUnauthenticatedExposureWarning } from './network-exposure.ts';
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
} from '../core/media/constants.ts';
import { MediaService } from '../core/media/media-service.ts';
import { MediaRepository } from '../core/database/repositories/media-repository.ts';
import { NodeFileSystem } from '../infrastructure/node-file-system.ts';
import { WorkerScannerService } from '../infrastructure/worker-scanner-service.ts';
import { MediaDurationHandler } from '../infrastructure/media-duration-handler.ts';

/**
 * The compiled bundle (dist/server/index.js), which `npm run web:start` and the
 * Docker image run with plain node, only ships the production workers and the
 * built client, so it defaults NODE_ENV to production. Running the sources
 * (tsx src/server/main.ts, as web:dev does) keeps the development default.
 */
export function applyDefaultNodeEnv(entryUrl: string = import.meta.url) {
  if (!process.env.NODE_ENV && !/\.[cm]?ts$/.test(entryUrl)) {
    process.env.NODE_ENV = 'production';
  }
}

export async function bootstrap() {
  // [SECURITY] Mark this process as web-server mode so core services can apply
  // network-appropriate defaults (e.g. confining /api/fs/* directory browsing
  // to the user's home dir unless ALLOWED_FS_ROOTS is set). The Electron build
  // never runs this bootstrap.
  process.env.MEDIAPLAYER_WEB_MODE = '1';
  applyDefaultNodeEnv();

  const host = process.env.HOST || DEFAULT_SERVER_HOST;
  const certDir = resolveCertDir();
  let credentials = await ensureCertificates({ certDir, host });

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

  const exposureWarning = getUnauthenticatedExposureWarning(host, port);
  if (exposureWarning) {
    console.warn(exposureWarning);
  }

  // No idle socket timeout: a reindex, a first scan or heatmap analysis can
  // keep a response silent for minutes, and a paused media stream stays idle
  // until the player reads again. Node's headersTimeout and requestTimeout
  // still bound how long a client may take to send its request.
  const server = https.createServer(credentials, app);
  installServerLifecycle(server);

  // A server that is never restarted (e.g. a NAS container) re-checks its
  // certificate daily, so the self-signed one is renewed before it expires
  // and a replaced one is picked up without a restart.
  const certRenewal = setInterval(() => {
    ensureCertificates({ certDir, host, quiet: true })
      .then((next) => {
        if (
          !next.cert.equals(credentials.cert) ||
          !next.key.equals(credentials.key)
        ) {
          server.setSecureContext(next);
          credentials = next;
          console.log('TLS certificate reloaded.');
        }
      })
      .catch((e: unknown) => {
        console.error('Certificate renewal failed:', e);
      });
  }, CERT_RENEWAL_CHECK_INTERVAL_MS);
  certRenewal.unref();
  server.on('close', () => clearInterval(certRenewal));

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
  bootstrap().catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
