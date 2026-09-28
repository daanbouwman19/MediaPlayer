/**
 * @file Shared playback-position helpers.
 *
 * Both the resume-on-replay logic in MediaDisplay and the "WATCHED"
 * indicator in MediaGridItem need to agree on what counts as
 * "effectively finished". Keeping the threshold here prevents drift
 * between the two consumers.
 */

/**
 * Fraction of duration past which a file is considered watched.
 * Crossing this threshold both shows the WATCHED badge and causes a
 * subsequent open to start from the beginning instead of resuming.
 */
export const WATCHED_THRESHOLD = 0.95;

/**
 * Returns true if the given playback position represents a finished
 * file under the shared WATCHED_THRESHOLD.
 */
export function isWatched(
  position: number | null | undefined,
  duration: number | null | undefined,
): boolean {
  if (!position || !duration || duration <= 0) return false;
  return position / duration >= WATCHED_THRESHOLD;
}

/**
 * Picks a random start position that still leaves `tailSeconds` to play
 * before the end. Returns 0 when the video is too short for that.
 */
export function pickRandomStartTime(
  duration: number,
  tailSeconds: number,
  random: () => number = Math.random,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const latest = duration - Math.max(0, tailSeconds);
  if (latest <= 1) return 0;
  return Math.floor(random() * latest);
}
