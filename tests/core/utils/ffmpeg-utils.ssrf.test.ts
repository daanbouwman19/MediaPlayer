// @vitest-environment node
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from 'vite-plus/test';
import http from 'http';
import type { AddressInfo } from 'net';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  getFFmpegStreams,
  getThumbnailArgs,
  runFFmpeg,
} from '../../../src/infrastructure/ffmpeg-utils';
import { getFFmpegStaticPath } from '../../../src/infrastructure/ffmpeg-static-path';

/**
 * Runs the real bundled ffmpeg against a "video" that is really a DASH
 * manifest pointing at a local HTTP server. Before the input hardening,
 * probing it made ffmpeg request http://127.0.0.1:<port>/metadata/init.mp4
 * (blind SSRF towards the LAN or cloud metadata endpoints).
 */
describe('ffmpeg input hardening (real ffmpeg)', () => {
  const ffmpegPath = getFFmpegStaticPath()!;
  const fixture = path.join(
    process.cwd(),
    'tests/fixtures/diversity/test_libx264_aac.mp4',
  );
  const requests: string[] = [];
  let tmpDir: string;
  let manifestPath: string;
  let manifest: string;
  let target: http.Server;
  let proxy: http.Server;
  let proxyUrl: string;

  const listen = async (server: http.Server) => {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    return (server.address() as AddressInfo).port;
  };

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-ssrf-'));

    target = http.createServer((req, res) => {
      requests.push(`target ${req.url}`);
      res.writeHead(404);
      res.end();
    });
    const targetPort = await listen(target);

    manifest = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S" minBufferTime="PT2S" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011">
<BaseURL>http://127.0.0.1:${targetPort}/metadata/</BaseURL>
<Period><AdaptationSet mimeType="video/mp4"><Representation id="1" bandwidth="1000" codecs="avc1.42E01E" width="320" height="240">
<SegmentTemplate initialization="init.mp4" media="seg$Number$.m4s" startNumber="1" duration="2" timescale="1"/>
</Representation></AdaptationSet></Period></MPD>`;
    manifestPath = path.join(tmpDir, 'clip.mp4');
    await fs.writeFile(manifestPath, manifest);

    // Stands in for the internal Drive proxy that serves the same file.
    proxy = http.createServer((req, res) => {
      requests.push(`proxy ${req.url}`);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': Buffer.byteLength(manifest),
      });
      res.end(manifest);
    });
    const proxyPort = await listen(proxy);
    proxyUrl = `http://127.0.0.1:${proxyPort}/stream/abc.mp4?token=t`;
  });

  afterAll(async () => {
    await new Promise((resolve) => target.close(resolve));
    await new Promise((resolve) => proxy.close(resolve));
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    requests.length = 0;
  });

  it('does not follow URLs from a DASH manifest disguised as a local video', async () => {
    const streams = await getFFmpegStreams(manifestPath, ffmpegPath);

    expect(requests).toEqual([]);
    expect(streams.hasVideo).toBe(false);
  }, 30000);

  it('does not follow them while generating a thumbnail', async () => {
    const out = path.join(tmpDir, 'thumb.jpg');
    const { code } = await runFFmpeg(
      ffmpegPath,
      getThumbnailArgs(manifestPath, out),
    );

    expect(requests).toEqual([]);
    expect(code).not.toBe(0);
  }, 30000);

  it('reads Drive media through the proxy but follows nothing else', async () => {
    const streams = await getFFmpegStreams(proxyUrl, ffmpegPath);

    expect(streams.hasVideo).toBe(false);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request).toMatch(/^proxy /);
    }
  }, 30000);

  it('still probes a real video', async () => {
    const streams = await getFFmpegStreams(fixture, ffmpegPath);

    expect(streams.hasVideo).toBe(true);
    expect(streams.videoCodec).toBe('h264');
    expect(streams.duration).toBeGreaterThan(0);
  }, 30000);
});
