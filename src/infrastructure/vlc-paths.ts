import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

// The VLC installer records its folder here (64-bit and 32-bit installs).
const WINDOWS_VLC_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\VideoLAN\\VLC',
  'HKLM\\SOFTWARE\\WOW6432Node\\VideoLAN\\VLC',
];
const REGISTRY_QUERY_TIMEOUT_MS = 5000;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Expands %VAR% references, as found in REG_EXPAND_SZ values. */
function expandWindowsEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (match, name: string) => {
    return process.env[name] ?? match;
  });
}

/** Program Files folders, wherever Windows is installed. */
function getProgramFilesCandidates(): string[] {
  const roots = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env['ProgramFiles(x86)'],
    'C:\\Program Files',
    'C:\\Program Files (x86)',
  ];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const root of roots) {
    if (!root || seen.has(root.toLowerCase())) continue;
    seen.add(root.toLowerCase());
    candidates.push(path.win32.join(root, 'VideoLAN', 'VLC', 'vlc.exe'));
  }
  return candidates;
}

/** Reads the InstallDir value of a VLC registry key, or null. */
function queryRegistryInstallDir(key: string): Promise<string | null> {
  const regExe = path.win32.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'reg.exe',
  );
  return new Promise((resolve) => {
    try {
      execFile(
        regExe,
        ['query', key, '/v', 'InstallDir'],
        { windowsHide: true, timeout: REGISTRY_QUERY_TIMEOUT_MS },
        (error, stdout) => {
          if (error) {
            resolve(null);
            return;
          }
          const match =
            /^\s*InstallDir\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/im.exec(
              String(stdout),
            );
          resolve(match?.[1] ? expandWindowsEnv(match[1]) : null);
        },
      );
    } catch {
      resolve(null);
    }
  });
}

/** Finds vlc.exe in an absolute PATH directory, or null. */
async function findVlcOnPath(): Promise<string | null> {
  const entries = (process.env.PATH ?? '').split(';');
  for (const entry of entries) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1');
    // Relative entries resolve against the working directory; skip them.
    if (!dir || !path.win32.isAbsolute(dir)) continue;
    const candidate = path.win32.join(dir, 'vlc.exe');
    if (await fileExists(candidate)) return candidate;
  }
  return null;
}

async function getWindowsVlcPath(): Promise<string | null> {
  for (const candidate of getProgramFilesCandidates()) {
    if (await fileExists(candidate)) return candidate;
  }

  for (const key of WINDOWS_VLC_REGISTRY_KEYS) {
    const installDir = await queryRegistryInstallDir(key);
    if (installDir) {
      const candidate = path.win32.join(installDir, 'vlc.exe');
      if (await fileExists(candidate)) return candidate;
    }
  }

  return findVlcOnPath();
}

async function getMacVlcPath(): Promise<string> {
  const macPath = '/Applications/VLC.app/Contents/MacOS/VLC';
  try {
    await fs.promises.access(macPath);
    return macPath;
  } catch {
    return 'vlc';
  }
}

async function getLinuxVlcPath(): Promise<string> {
  const commonPaths = [
    '/usr/bin/vlc',
    '/usr/local/bin/vlc',
    '/snap/bin/vlc',
    '/var/lib/flatpak/exports/bin/org.videolan.VLC',
  ];

  for (const p of commonPaths) {
    try {
      await fs.promises.access(p);
      return p;
    } catch {
      // Continue checking
    }
  }
  return 'vlc';
}

export async function getVlcPath(): Promise<string | null> {
  if (process.platform === 'win32') {
    return getWindowsVlcPath();
  }
  if (process.platform === 'darwin') {
    return getMacVlcPath();
  }
  if (process.platform === 'linux') {
    return getLinuxVlcPath();
  }
  return 'vlc';
}
