/**
 * @file HLS streaming handlers.
 * Extracted from media-handler.ts to separate concerns.
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs/promises';

import { HlsManager } from './hls-manager.ts';
import { getAuthorizedPath } from './access-utils.ts';
import { getQueryParam } from './utils/http-utils.ts';

const HLS_BANDWIDTH = 2000000;
const HLS_RESOLUTION = '1280x720';

import { isDrivePath } from './media-utils.ts';

/**
 * Generates a session ID based on the file path.
 */
export async function generateSessionId(filePath: string): Promise<string> {
  let canonicalPath = filePath;
  if (!isDrivePath(filePath)) {
    try {
      canonicalPath = await fs.realpath(filePath);
    } catch (err) {
      // Fallback to original path if realpath fails
      console.warn(
        `[HLS] realpath failed for "${filePath}", falling back to original path.`,
        err,
      );
      canonicalPath = filePath;
    }
  }
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

  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(`#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=${HLS_BANDWIDTH},RESOLUTION=${HLS_RESOLUTION}
playlist.m3u8?file=${encodedFile}`);
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

  try {
    const hlsManager = HlsManager.getInstance();
    await hlsManager.ensureSession(sessionId, authorizedPath);

    const sessionDir = hlsManager.getSessionDir(sessionId);
    if (!sessionDir) throw new Error('Session dir not found');

    const playlistPath = path.join(sessionDir, 'playlist.m3u8');
    let playlistContent = await fs.readFile(playlistPath, 'utf8');

    // Rewrite segment paths to include the file query param
    // The segments are named 'segment_000.ts'
    // We want 'segment_000.ts?file=...'
    const fileQuery = getQueryParam(req.query, 'file');
    const encodedFile = encodeURIComponent(fileQuery || '');

    // Simple regex replace
    // Use a more robust regex that handles potential variations in segment naming
    const segmentRegex = /(segment_\d+\.ts)/g;
    playlistContent = playlistContent.replace(
      segmentRegex,
      `$1?file=${encodedFile}`,
    );

    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.send(playlistContent);

    // Keep session alive
    hlsManager.touchSession(sessionId);
  } catch (err) {
    console.error('[HLS] Playlist error:', err);
    res.status(500).send('HLS Generation failed');
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
  if (!/^segment_\d+\.ts$/.test(segmentName)) {
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

  const segmentPath = path.join(sessionDir, segmentName);

  try {
    await new Promise<void>((resolve, reject) => {
      res.sendFile(segmentPath, (err) => {
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
  }
}
