// @vitest-environment node
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vite-plus/test';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { serveHeatmap } from '../../src/core/media/media-handler';
import {
  HeatmapBusyError,
  HEATMAP_BUSY_MESSAGE,
} from '../../src/core/media/analysis/heatmap-errors';

const { mockGenerateHeatmap } = vi.hoisted(() => ({
  mockGenerateHeatmap: vi.fn(),
}));

vi.mock('../../src/core/auth/access-validator', () => ({
  validateFileAccess: async (filePath: string) => ({
    success: true,
    path: filePath,
  }),
  handleAccessCheck: () => false,
}));

vi.mock('../../src/core/media/analysis/media-analyzer', () => ({
  MediaAnalyzer: {
    getInstance: () => ({ generateHeatmap: mockGenerateHeatmap }),
  },
}));

describe('serveHeatmap', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.get('/heatmap', async (req, res) => {
      await serveHeatmap(req, res, req.query.file as string);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the heatmap and hands the analyzer a cancellation signal', async () => {
    const data = { audio: [-90], motion: [1], points: 1 };
    mockGenerateHeatmap.mockResolvedValue(data);

    const res = await request(app)
      .get('/heatmap')
      .query({ file: '/v/a.mp4', points: '1' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(data);
    expect(mockGenerateHeatmap).toHaveBeenCalledWith('/v/a.mp4', 1, {
      signal: expect.any(AbortSignal),
    });
  });

  it('answers 503 with Retry-After when all analysis slots are busy', async () => {
    mockGenerateHeatmap.mockRejectedValue(new HeatmapBusyError());

    const res = await request(app).get('/heatmap').query({ file: '/v/a.mp4' });

    expect(res.status).toBe(503);
    expect(res.headers['retry-after']).toBe('5');
    expect(res.body).toEqual({ error: HEATMAP_BUSY_MESSAGE });
  });

  it('answers 500 when the analysis fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockGenerateHeatmap.mockRejectedValue(new Error('boom'));

    const res = await request(app).get('/heatmap').query({ file: '/v/a.mp4' });

    expect(res.status).toBe(500);
    expect(res.text).toBe('Heatmap generation failed');
  });

  it('leaves the analysis when the client disconnects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let seenSignal: AbortSignal | undefined;
    mockGenerateHeatmap.mockImplementation(
      (_path: string, _points: number, options: { signal: AbortSignal }) => {
        seenSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      },
    );

    const server = app.listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const clientReq = http.get(
        `http://127.0.0.1:${port}/heatmap?file=%2Fv%2Flong.mkv`,
      );
      clientReq.on('error', () => {});
      await vi.waitFor(() => expect(seenSignal).toBeDefined());
      expect(seenSignal?.aborted).toBe(false);

      clientReq.destroy();
      await vi.waitFor(() => expect(seenSignal?.aborted).toBe(true));
      // An abandoned request is not an error.
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
