import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authorizeFilePath } from '../../src/core/auth/security';
import path from 'path';
import fs from 'fs/promises';
import * as database from '../../src/core/database/database';

vi.mock('fs/promises', () => {
  return {
    default: {
      realpath: vi.fn(async (p) => p),
      readFile: vi.fn(),
    },
  };
});
vi.mock('../../src/core/database/database');

describe('authorizeFilePath Extension Security', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(database.getMediaDirectories).mockResolvedValue([
      {
        path: '/allowed',
        type: 'local',
        id: '1',
        name: 'Allowed',
        isActive: true,
      },
    ]);
    (vi.mocked(fs.realpath) as any).mockImplementation(async (p: string) =>
      path.resolve(p),
    );
  });

  it('should block .env variants', async () => {
    const variants = [
      '.env',
      '.env.local',
      '.env.production',
      '.env.backup',
      '.env.old',
    ];
    for (const v of variants) {
      const res = await authorizeFilePath(`/allowed/${v}`);
      expect(res.isAllowed, `Failed to block ${v}`).toBe(false);
    }
  });

  it('should block SSH private key variants', async () => {
    const keys = ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'];
    for (const key of keys) {
      // Exact match
      let res = await authorizeFilePath(`/allowed/${key}`);
      expect(res.isAllowed, `Failed to block ${key}`).toBe(false);

      // Backup variant
      res = await authorizeFilePath(`/allowed/${key}.bak`);
      expect(res.isAllowed, `Failed to block ${key}.bak`).toBe(false);

      // Old variant
      res = await authorizeFilePath(`/allowed/${key}.old`);
      expect(res.isAllowed, `Failed to block ${key}.old`).toBe(false);
    }
  });

  it('should allow SSH public keys', async () => {
    const keys = ['id_rsa.pub', 'id_dsa.pub', 'id_ecdsa.pub', 'id_ed25519.pub'];
    for (const key of keys) {
      const res = await authorizeFilePath(`/allowed/${key}`);
      expect(res.isAllowed, `Failed to allow ${key}`).toBe(true);
    }
  });

  it('should block Server Certificate/Key variants', async () => {
    const files = ['server.key', 'server.crt', 'server.cert'];
    for (const f of files) {
      let res = await authorizeFilePath(`/allowed/${f}`);
      expect(res.isAllowed, `Failed to block ${f}`).toBe(false);

      res = await authorizeFilePath(`/allowed/${f}.bak`);
      expect(res.isAllowed, `Failed to block ${f}.bak`).toBe(false);
    }
  });

  it('should block Docker file variants', async () => {
    const files = [
      'Dockerfile',
      'Dockerfile.dev',
      'Dockerfile.prod',
      'docker-compose.yml',
      'docker-compose.override.yml',
      'docker-compose.v2.yml',
    ];
    for (const f of files) {
      const res = await authorizeFilePath(`/allowed/${f}`);
      expect(res.isAllowed, `Failed to block ${f}`).toBe(false);
    }
  });

  it('should block Package Manager file variants', async () => {
    const files = [
      'package.json',
      'package.json.bak',
      'package-lock.json',
      'yarn.lock',
      'yarn.lock.old',
      'pnpm-lock.yaml',
      '.npmrc',
      '.npmrc.backup',
    ];
    for (const f of files) {
      const res = await authorizeFilePath(`/allowed/${f}`);
      expect(res.isAllowed, `Failed to block ${f}`).toBe(false);
    }
  });

  it('should block Shell History/Config variants', async () => {
    const files = [
      '.bash_history',
      '.bash_history.1',
      '.zsh_history',
      '.bashrc',
      '.bashrc.save',
      '.profile',
      '.profile.bak',
    ];
    for (const f of files) {
      const res = await authorizeFilePath(`/allowed/${f}`);
      expect(res.isAllowed, `Failed to block ${f}`).toBe(false);
    }
  });

  it('should block System file variants', async () => {
    const files = ['NTUSER.DAT', 'ntuser.dat.LOG1', 'boot.ini', 'boot.ini.bak'];
    for (const f of files) {
      const res = await authorizeFilePath(`/allowed/${f}`);
      expect(res.isAllowed, `Failed to block ${f}`).toBe(false);
    }
  });
});
