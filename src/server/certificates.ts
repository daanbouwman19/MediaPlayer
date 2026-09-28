/**
 * @file Self-signed TLS certificate bootstrap for the web server.
 */
import fs from 'fs/promises';
import net from 'net';
import path from 'path';
import { X509Certificate, createPrivateKey } from 'crypto';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Validity of a newly generated certificate. */
export const CERT_VALIDITY_DAYS = 365;

/** A self-signed certificate is regenerated when it expires within this window. */
export const CERT_RENEWAL_WINDOW_DAYS = 30;

/** How often a running server re-checks (and if needed renews) its certificate. */
export const CERT_RENEWAL_CHECK_INTERVAL_MS = DAY_MS;

export interface TlsCredentials {
  key: Buffer;
  cert: Buffer;
}

export interface EnsureCertificatesOptions {
  /** Directory holding server.key and server.cert. */
  certDir: string;
  /** The HOST the server binds to; added to the certificate's SAN. */
  host: string;
  /** Clock override for tests. */
  now?: Date;
  /** Skips the log line for a kept certificate (periodic re-checks). */
  quiet?: boolean;
}

/**
 * Resolves the certificate directory: CERT_DIR when set, otherwise ./certs.
 * web:dev's Vite server reads the certificate from the same place.
 */
export function resolveCertDir(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  return path.resolve(cwd, env.CERT_DIR || 'certs');
}

function isWildcardHost(host: string): boolean {
  return host === '' || host === '0.0.0.0' || host === '::' || host === '[::]';
}

function buildAltNames(host: string) {
  const altNames: { type: 2 | 7; value?: string; ip?: string }[] = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    { type: 7, ip: '::1' },
  ];
  const bareHost = host.trim().replace(/^\[(.*)\]$/, '$1');
  if (isWildcardHost(bareHost)) {
    return altNames;
  }
  if (net.isIP(bareHost)) {
    if (!altNames.some((alt) => alt.ip === bareHost)) {
      altNames.push({ type: 7, ip: bareHost });
    }
  } else if (bareHost.toLowerCase() !== 'localhost') {
    altNames.push({ type: 2, value: bareHost });
  }
  return altNames;
}

async function readCredentials(
  keyPath: string,
  certPath: string,
): Promise<TlsCredentials | null> {
  try {
    const [key, cert] = await Promise.all([
      fs.readFile(keyPath),
      fs.readFile(certPath),
    ]);
    return { key, cert };
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(
      'An unexpected error occurred while checking for SSL certificates:',
      e,
    );
    throw e;
  }
}

interface CertificateCheck {
  selfSigned: boolean;
  /** Why the certificate must be regenerated; null to keep it. */
  renewalReason: string | null;
}

/**
 * Decides whether the existing certificate can be kept. Only self-signed
 * certificates are regenerated: a CA-issued certificate the operator
 * installed is never overwritten.
 */
function checkCertificate(
  credentials: TlsCredentials,
  certPath: string,
  now: Date,
): CertificateCheck {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(credentials.cert);
  } catch (e: unknown) {
    throw new Error(
      `Invalid TLS certificate ${certPath}. Delete it and server.key to generate a new one.`,
      { cause: e },
    );
  }
  const validTo = x509.validToDate;
  const remainingMs = validTo.getTime() - now.getTime();
  const expiresSoon = remainingMs < CERT_RENEWAL_WINDOW_DAYS * DAY_MS;
  const selfSigned =
    x509.issuer === x509.subject && x509.verify(x509.publicKey);

  if (!selfSigned) {
    if (expiresSoon) {
      console.warn(
        `[SECURITY] The TLS certificate ${certPath} expires on ${validTo.toISOString()}. It is not self-signed, so it is not renewed automatically: replace it.`,
      );
    }
    return { selfSigned, renewalReason: null };
  }
  let keyMatches = false;
  try {
    keyMatches = x509.checkPrivateKey(createPrivateKey(credentials.key));
  } catch {
    // An unreadable key is replaced like a mismatching one.
  }
  if (!keyMatches) {
    return {
      selfSigned,
      renewalReason: 'the private key does not match the certificate',
    };
  }
  if (remainingMs <= 0) {
    return {
      selfSigned,
      renewalReason: `it expired on ${validTo.toISOString()}`,
    };
  }
  if (expiresSoon) {
    return {
      selfSigned,
      renewalReason: `it expires on ${validTo.toISOString()}`,
    };
  }
  return { selfSigned, renewalReason: null };
}

async function generateCredentials(
  host: string,
  now: Date,
): Promise<TlsCredentials> {
  // Loaded lazily: it is only needed on first start and on renewal.
  const { generate } = await import('selfsigned');
  const pems = await generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    keySize: 2048,
    notBeforeDate: now,
    notAfterDate: new Date(now.getTime() + CERT_VALIDITY_DAYS * DAY_MS),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      {
        name: 'keyUsage',
        digitalSignature: true,
        keyEncipherment: true,
        critical: true,
      },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: buildAltNames(host) },
    ],
  });
  return { key: Buffer.from(pems.private), cert: Buffer.from(pems.cert) };
}

/** Restricts the private key to its owner. Best effort (e.g. read-only mounts). */
async function restrictKeyPermissions(keyPath: string): Promise<void> {
  try {
    await fs.chmod(keyPath, 0o600);
  } catch {
    // Not fatal: the key stays usable, only its mode is unchanged.
  }
}

/**
 * Returns the server's TLS credentials, generating a self-signed certificate
 * when none exists and renewing it when it is about to expire.
 */
export async function ensureCertificates({
  certDir,
  host,
  now = new Date(),
  quiet = false,
}: EnsureCertificatesOptions): Promise<TlsCredentials> {
  const keyPath = path.join(certDir, 'server.key');
  const certPath = path.join(certDir, 'server.cert');

  const existing = await readCredentials(keyPath, certPath);
  if (existing) {
    const { selfSigned, renewalReason } = checkCertificate(
      existing,
      certPath,
      now,
    );
    if (!renewalReason) {
      if (!quiet) {
        console.log('SSL Certificates found.');
      }
      if (selfSigned) {
        // Older versions wrote the generated key world-readable.
        await restrictKeyPermissions(keyPath);
      }
      return existing;
    }
    console.warn(
      `Regenerating the self-signed SSL certificate: ${renewalReason}.`,
    );
  } else {
    console.log('Generating SSL Certificates...');
  }

  await fs.mkdir(certDir, { recursive: true });
  const credentials = await generateCredentials(host, now);

  // The mode only applies when the file is created, so also chmod when an
  // older, world-readable key is replaced.
  await fs.writeFile(keyPath, credentials.key, { mode: 0o600 });
  await restrictKeyPermissions(keyPath);
  await fs.writeFile(certPath, credentials.cert);

  console.log('SSL Certificates generated successfully.');
  return credentials;
}
