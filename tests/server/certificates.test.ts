import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { X509Certificate } from 'crypto';
import { generate } from 'selfsigned';
import {
  CERT_RENEWAL_WINDOW_DAYS,
  CERT_VALIDITY_DAYS,
  ensureCertificates,
  resolveCertDir,
} from '../../src/server/certificates';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('resolveCertDir', () => {
  it('defaults to ./certs', () => {
    expect(resolveCertDir({}, path.resolve('/srv/app'))).toBe(
      path.resolve('/srv/app/certs'),
    );
  });

  it('honours CERT_DIR, relative to the working directory', () => {
    expect(
      resolveCertDir({ CERT_DIR: '/app/data/certs' }, path.resolve('/srv')),
    ).toBe(path.resolve('/app/data/certs'));
    expect(resolveCertDir({ CERT_DIR: 'tls' }, path.resolve('/srv'))).toBe(
      path.resolve('/srv/tls'),
    );
  });
});

describe('ensureCertificates', { timeout: 60_000 }, () => {
  let tmpDir: string;
  let certDir: string;
  let keyPath: string;
  let certPath: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mediaplayer-certs-'));
    certDir = path.join(tmpDir, 'nested', 'certs');
    keyPath = path.join(certDir, 'server.key');
    certPath = path.join(certDir, 'server.cert');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function readCert() {
    return new X509Certificate(await fs.readFile(certPath));
  }

  it('generates a one-year certificate with an owner-only private key', async () => {
    const now = new Date();

    const credentials = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
      now,
    });

    const x509 = await readCert();
    expect(credentials.cert.equals(await fs.readFile(certPath))).toBe(true);
    expect(credentials.key.equals(await fs.readFile(keyPath))).toBe(true);
    expect(x509.validToDate.getTime()).toBeGreaterThan(
      now.getTime() + (CERT_VALIDITY_DAYS - 1) * DAY_MS,
    );
    expect(x509.subjectAltName).toContain('DNS:localhost');
    expect(x509.subjectAltName).toContain('IP Address:127.0.0.1');
    if (process.platform !== 'win32') {
      expect((await fs.stat(keyPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('adds the configured HOST to the subject alternative names', async () => {
    await ensureCertificates({ certDir, host: '192.168.1.20' });
    expect((await readCert()).subjectAltName).toContain(
      'IP Address:192.168.1.20',
    );

    await fs.rm(certDir, { recursive: true });
    await ensureCertificates({ certDir, host: 'media.lan' });
    expect((await readCert()).subjectAltName).toContain('DNS:media.lan');
  });

  it('does not add wildcard hosts to the subject alternative names', async () => {
    await ensureCertificates({ certDir, host: '0.0.0.0' });

    const altNames = (await readCert()).subjectAltName ?? '';
    expect(altNames).not.toContain('0.0.0.0');
    expect(altNames).toContain('DNS:localhost');
  });

  it('keeps a valid certificate', async () => {
    const first = await ensureCertificates({ certDir, host: '127.0.0.1' });

    const second = await ensureCertificates({ certDir, host: '127.0.0.1' });

    expect(second.cert.equals(first.cert)).toBe(true);
    expect(second.key.equals(first.key)).toBe(true);
  });

  it('does not log a kept certificate when quiet', async () => {
    await ensureCertificates({ certDir, host: '127.0.0.1' });
    expect(console.log).toHaveBeenCalledWith(
      'SSL Certificates generated successfully.',
    );
    vi.mocked(console.log).mockClear();

    await ensureCertificates({ certDir, host: '127.0.0.1', quiet: true });
    expect(console.log).not.toHaveBeenCalled();

    await ensureCertificates({ certDir, host: '127.0.0.1' });
    expect(console.log).toHaveBeenCalledWith('SSL Certificates found.');
  });

  it('tightens the permissions of an existing world-readable key', async () => {
    await ensureCertificates({ certDir, host: '127.0.0.1' });
    await fs.chmod(keyPath, 0o644);

    await ensureCertificates({ certDir, host: '127.0.0.1' });

    if (process.platform !== 'win32') {
      expect((await fs.stat(keyPath)).mode & 0o777).toBe(0o600);
    }
  });

  it('renews a certificate that is about to expire', async () => {
    const now = new Date();
    const issued = new Date(
      now.getTime() -
        (CERT_VALIDITY_DAYS - CERT_RENEWAL_WINDOW_DAYS + 5) * DAY_MS,
    );
    const old = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
      now: issued,
    });

    const renewed = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
      now,
    });

    expect(renewed.cert.equals(old.cert)).toBe(false);
    expect((await readCert()).validToDate.getTime()).toBeGreaterThan(
      now.getTime() + (CERT_VALIDITY_DAYS - 1) * DAY_MS,
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('it expires on'),
    );
  });

  it('keeps a near-expiry certificate when it cannot be renewed', async () => {
    const now = new Date();
    const old = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
      now: new Date(
        now.getTime() -
          (CERT_VALIDITY_DAYS - CERT_RENEWAL_WINDOW_DAYS + 5) * DAY_MS,
      ),
    });
    const readOnly = Object.assign(new Error('read-only file system'), {
      code: 'EROFS',
    });
    const writeFile = vi.spyOn(fs, 'writeFile').mockRejectedValue(readOnly);

    const kept = await ensureCertificates({ certDir, host: '127.0.0.1', now });

    expect(writeFile).toHaveBeenCalled();
    expect(kept.key.equals(old.key)).toBe(true);
    expect(kept.cert.equals(old.cert)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not renew'),
      readOnly,
    );
  });

  it('still fails when an expired certificate cannot be renewed', async () => {
    const now = new Date();
    await ensureCertificates({
      certDir,
      host: '127.0.0.1',
      now: new Date(now.getTime() - (CERT_VALIDITY_DAYS + 30) * DAY_MS),
    });
    const readOnly = Object.assign(new Error('read-only file system'), {
      code: 'EROFS',
    });
    vi.spyOn(fs, 'writeFile').mockRejectedValue(readOnly);

    await expect(
      ensureCertificates({ certDir, host: '127.0.0.1', now }),
    ).rejects.toBe(readOnly);
  });

  it('renews an expired certificate', async () => {
    const now = new Date();
    await ensureCertificates({
      certDir,
      host: '127.0.0.1',
      now: new Date(now.getTime() - (CERT_VALIDITY_DAYS + 30) * DAY_MS),
    });

    await ensureCertificates({ certDir, host: '127.0.0.1', now });

    expect((await readCert()).validToDate.getTime()).toBeGreaterThan(
      now.getTime(),
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('it expired on'),
    );
  });

  it('regenerates when the key does not match the certificate', async () => {
    await ensureCertificates({ certDir, host: '127.0.0.1' });
    const other = await generate(undefined, { algorithm: 'sha256' });
    await fs.writeFile(keyPath, other.private);

    const credentials = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
    });

    const x509 = new X509Certificate(credentials.cert);
    const { createPrivateKey } = await import('crypto');
    expect(x509.checkPrivateKey(createPrivateKey(credentials.key))).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('does not match'),
    );
  });

  it('regenerates when the self-signed certificate has an unreadable key', async () => {
    await ensureCertificates({ certDir, host: '127.0.0.1' });
    await fs.writeFile(keyPath, 'not a key');

    const credentials = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
    });

    expect(credentials.key.toString()).toContain('PRIVATE KEY');
    expect(await fs.readFile(keyPath, 'utf8')).toContain('PRIVATE KEY');
  });

  it('never overwrites a CA-issued certificate, even an expired one', async () => {
    const ca = await generate([{ name: 'commonName', value: 'Test CA' }], {
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      ],
    });
    const leaf = await generate([{ name: 'commonName', value: 'media.lan' }], {
      algorithm: 'sha256',
      notBeforeDate: new Date(Date.now() - 400 * DAY_MS),
      notAfterDate: new Date(Date.now() - DAY_MS),
      ca: { key: ca.private, cert: ca.cert },
    });
    await fs.mkdir(certDir, { recursive: true });
    await fs.writeFile(keyPath, leaf.private);
    await fs.writeFile(certPath, leaf.cert);

    const credentials = await ensureCertificates({
      certDir,
      host: '127.0.0.1',
    });

    expect(credentials.cert.toString()).toBe(leaf.cert);
    expect(await fs.readFile(certPath, 'utf8')).toBe(leaf.cert);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('not renewed automatically'),
    );
  });

  it('rejects a corrupt certificate instead of overwriting it', async () => {
    await fs.mkdir(certDir, { recursive: true });
    await fs.writeFile(keyPath, 'not a key');
    await fs.writeFile(certPath, 'not a certificate');

    await expect(
      ensureCertificates({ certDir, host: '127.0.0.1' }),
    ).rejects.toThrow('Invalid TLS certificate');
    expect(await fs.readFile(certPath, 'utf8')).toBe('not a certificate');
  });

  it('rethrows unexpected errors while reading the certificates', async () => {
    await fs.mkdir(certPath, { recursive: true });
    await fs.writeFile(keyPath, 'key');

    await expect(
      ensureCertificates({ certDir, host: '127.0.0.1' }),
    ).rejects.toMatchObject({ code: 'EISDIR' });
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('unexpected error'),
      expect.anything(),
    );
  });
});
