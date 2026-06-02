import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateFileUrl } from '../../src/core/media/media-handler';
import * as security from '../../src/core/auth/security';
import * as providerFactory from '../../src/infrastructure/fs-provider-factory';

vi.mock('../../src/core/auth/security');
vi.mock('../../src/infrastructure/fs-provider-factory');
vi.mock('../../src/core/media/media-utils');

describe('generateFileUrl Security Check', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should call authorizeFilePath for drive paths', async () => {
    const filePath = 'gdrive://unauthorized-file-id';

    // Mock authorizeFilePath to return false (access denied)
    vi.mocked(security.authorizeFilePath).mockResolvedValue({
      isAllowed: false,
      message: 'Access denied',
    });

    // Mock getProvider to return a dummy provider so we don't crash if auth is bypassed
    vi.mocked(providerFactory.getProvider).mockReturnValue({
      getMetadata: vi
        .fn()
        .mockResolvedValue({ size: 100, mimeType: 'text/plain' }),
      getStream: vi.fn().mockResolvedValue({
        stream: (async function* () {
          yield Buffer.from('data');
        })(),
      }),
    } as any);

    const result = await generateFileUrl(filePath, { serverPort: 3000 });

    // Expect auth to be checked
    expect(security.authorizeFilePath).toHaveBeenCalledWith(filePath);

    // Expect error because access is denied
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.message).toContain('Access denied');
    }
  });
});
