import fs from 'fs';

async function getWindowsVlcPath(): Promise<string | null> {
  const commonPaths = [
    'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
    'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
  ];
  for (const p of commonPaths) {
    try {
      await fs.promises.access(p);
      return p;
    } catch {
      // Continue checking
    }
  }
  return null;
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
