/**
 * @file Startup check for a server that is reachable from the network without
 * authentication.
 */
import net from 'net';

/**
 * Whether `host` only accepts connections from this machine. Hostnames other
 * than localhost are treated as reachable, since they cannot be resolved
 * reliably at this point.
 */
export function isLoopbackHost(host: string): boolean {
  const bare = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return true;
  }
  if (net.isIPv4(bare)) {
    return bare.startsWith('127.');
  }
  if (net.isIPv6(bare)) {
    const mappedIPv4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bare)?.[1];
    if (mappedIPv4) {
      return mappedIPv4.startsWith('127.');
    }
    return (
      bare === '::1' || /^(0{1,4}:){7}0{0,3}1$/.test(bare) // expanded ::1
    );
  }
  return false;
}

/** Whether GLOBAL_PASSWORD or SYSTEM_USER/SYSTEM_PASSWORD protect the API. */
export function isAuthConfigured(env: NodeJS.ProcessEnv = process.env) {
  return (
    Boolean(env.GLOBAL_PASSWORD) ||
    (Boolean(env.SYSTEM_USER) && Boolean(env.SYSTEM_PASSWORD))
  );
}

/**
 * Returns a warning when the server binds a non-loopback host while no
 * authentication is configured, or null when it is not exposed that way.
 */
export function getUnauthenticatedExposureWarning(
  host: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (isLoopbackHost(host) || isAuthConfigured(env)) {
    return null;
  }
  const rule = '='.repeat(78);
  return [
    rule,
    `[SECURITY] WARNING: the server listens on ${host}:${port}, which other machines can reach, and no authentication is configured.`,
    'Anyone who can reach this port can browse your files, add media sources, stream media and start transcodes.',
    'Set GLOBAL_PASSWORD (or SYSTEM_USER and SYSTEM_PASSWORD), or set HOST=127.0.0.1.',
    "In Docker, publish the port on the host's loopback only (127.0.0.1:3000:3000) unless authentication is set.",
    rule,
  ].join('\n');
}
