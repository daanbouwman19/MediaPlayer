/**
 * @file HLS streaming handlers.
 * Extracted from media-handler.ts to separate concerns.
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

import { HlsManager } from './hls-manager.ts';
import { getAuthorizedPath } from '../auth/access-utils.ts';
import { getQueryParam } from '../network/http-utils.ts';

const HLS_BANDWIDTH = 2000000;
const HLS_RESOLUTION = '1280x720';

import { isDrivePath } from './media-utils.ts';

/**
 * Generates a session ID based on the file path.
 * Caller should provide a validated/canonical path.
 */
export async function generateSessionId(
  validatedPath: string,
): Promise<string> {
  const canonicalPath = isDrivePath(validatedPath)
    ? validatedPath
    : path.normalize(validatedPath);

  return crypto.createHash('md5').update(canonicalPath).digest('hex');
}

/**
 * Serves the HLS Master Playlist.
 */
export async function serveHlsMaster(
  req: Request,
  res: Response,
  filePath: string,
) {
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  const fileQuery = getQueryParam(req.query, 'file');
  const encodedFile = encodeURIComponent(fileQuery || '');

  // EXT-X-START: the media playlist stays "live" (no ENDLIST) while ffmpeg
  // runs, and players would otherwise start near its end instead of at 0.
  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-START:TIME-OFFSET=0
#EXT-X-STREAM-INF:BANDWIDTH=${HLS_BANDWIDTH},RESOLUTION=${HLS_RESOLUTION}
playlist.m3u8?file=${encodedFile}`);
}

/** True for the HlsBusyError thrown when the transcode cap is reached. */
function isBusyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'HLS_BUSY'
  );
}

/**
 * Serves the HLS Variant Playlist.
 */
export async function serveHlsPlaylist(
  req: Request,
  res: Response,
  filePath: string,
) {
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  const sessionId = await generateSessionId(authorizedPath);
  const hlsManager = HlsManager.getInstance();
  let acquired = false;
  let closed = false;
  const release = () => {
    if (acquired) {
      acquired = false;
      hlsManager.releaseSession(sessionId);
    }
  };
  res.on('close', () => {
    closed = true;
    release();
  });

  try {
    await hlsManager.ensureSession(sessionId, authorizedPath);
    hlsManager.acquireSession(sessionId);
    acquired = true;
    if (closed) {
      // The client gave up while ffmpeg was starting (the session did not
      // exist yet when 'close' fired). Release now so the idle timer is
      // armed; a leaked consumer would keep ffmpeg running for minutes.
      release();
      return;
    }

    const sessionDir = hlsManager.getSessionDir(sessionId);
    if (!sessionDir) throw new Error('Session dir not found');

    const playlistPath = path.join(sessionDir, 'playlist.m3u8');
    let playlistContent = await fs.readFile(playlistPath, 'utf8');

    // Rewrite segment paths to include the file query param
    // The segments are named 'segment_000.ts'
    // We want 'segment_000.ts?file=...'
    const fileQuery = getQueryParam(req.query, 'file');
    const encodedFile = encodeURIComponent(fileQuery || '');

    const segmentRegex = /(seg-\d+\.ts)/g;
    playlistContent = playlistContent.replace(
      segmentRegex,
      `$1?file=${encodedFile}`,
    );

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlistContent);

    // Keep session alive
    hlsManager.touchSession(sessionId);
  } catch (err) {
    if (isBusyError(err)) {
      // Temporary: the player may retry once a transcode slot frees up.
      if (!res.headersSent) {
        res.set('Retry-After', '10');
        res.status(503).send('Server too busy. Please try again later.');
      }
    } else {
      console.error('[HLS] Playlist error:', err);
      if (!res.headersSent) {
        res.status(500).send('HLS Generation failed');
      }
    }
    release();
  }
}

/**
 * Serves an HLS Segment.
 */
export async function serveHlsSegment(
  _req: Request,
  res: Response,
  filePath: string,
  segmentName: string,
) {
  const authorizedPath = await getAuthorizedPath(res, filePath);
  if (!authorizedPath) return;

  // Security check: segmentName must match the expected pattern strictly
  if (!/^seg-\d+\.ts$/.test(segmentName)) {
    res.status(400).send('Invalid segment name');
    return;
  }

  const sessionId = await generateSessionId(authorizedPath);
  const hlsManager = HlsManager.getInstance();
  const sessionDir = hlsManager.getSessionDir(sessionId);

  // If session doesn't exist, we can't serve segment.
  // The player should have requested playlist first which creates session.
  // If session timed out, we assume segment is gone.
  if (!sessionDir) {
    res.status(404).send('Segment not found (Session expired)');
    return;
  }

  hlsManager.acquireSession(sessionId);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    hlsManager.releaseSession(sessionId);
  };
  res.on('close', release);

  const segmentPath = path.join(sessionDir, segmentName);

  try {
    await new Promise<void>((resolve, reject) => {
      // dotfiles: 'allow' because Express 5 (send 1.x) otherwise 404s any
      // absolute path with a dot-directory in it, such as the Linux cache
      // under ~/.config. The path is built here from a validated name.
      res.sendFile(segmentPath, { dotfiles: 'allow' }, (err) => {
        if (err) {
          return reject(err);
        }
        hlsManager.touchSession(sessionId);
        resolve();
      });
    });
  } catch {
    if (!res.headersSent) {
      res.status(404).send('Segment not found');
    }
    release();
  }
}
