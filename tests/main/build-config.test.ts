import { describe, it, expect, vi, afterEach } from 'vite-plus/test';
import fs from 'fs';
import path from 'path';
import type { PluginOption } from 'vite-plus';
import viteConfig from '../../vite.config';

interface PackageJson {
  scripts: Record<string, string>;
  build: { files: string[] };
  allowScripts: Record<string, boolean>;
}

const pkg = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, '../../package.json'),
    'utf8',
  ),
) as PackageJson;

/**
 * Whether electron-builder packs `file` into the asar: like its matcher, the
 * patterns apply in order, and a later negated pattern removes a match.
 */
function isPackaged(file: string): boolean {
  let included = false;
  for (const pattern of pkg.build.files) {
    if (pattern.startsWith('!')) {
      if (included && path.posix.matchesGlob(file, pattern.slice(1))) {
        included = false;
      }
    } else if (!included && path.posix.matchesGlob(file, pattern)) {
      included = true;
    }
  }
  return included;
}

async function pluginNames(plugins: PluginOption[] = []): Promise<string[]> {
  const names: string[] = [];
  for (const option of plugins) {
    const plugin = await option;
    if (Array.isArray(plugin)) names.push(...(await pluginNames(plugin)));
    else if (plugin) names.push(plugin.name);
  }
  return names;
}

function buildConfig(target: string, mode = 'production') {
  vi.stubEnv('VITE_TARGET', target);
  return viteConfig({ command: 'build', mode });
}

describe('Electron packaging (package.json build.files)', () => {
  it('packs the built app', () => {
    expect(isPackaged('out/main/index.js')).toBe(true);
    expect(isPackaged('out/preload/preload.cjs')).toBe(true);
    expect(isPackaged('out/renderer/index.html')).toBe(true);
    expect(isPackaged('out/renderer/assets/index-abc123.js')).toBe(true);
  });

  it('leaves out source maps and the bundle report', () => {
    expect(isPackaged('out/main/index.js.map')).toBe(false);
    expect(isPackaged('out/preload/preload.cjs.map')).toBe(false);
    expect(isPackaged('out/renderer/assets/index-abc123.js.map')).toBe(false);
    expect(isPackaged('out/renderer/stats.html')).toBe(false);
  });
});

describe('Vite build config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['renderer', 'client'])(
    'only adds the bundle visualizer to %s builds with ANALYZE=1',
    async (target) => {
      vi.stubEnv('ANALYZE', undefined);
      expect(await pluginNames(buildConfig(target).plugins)).not.toContain(
        'visualizer',
      );

      vi.stubEnv('ANALYZE', '1');
      expect(await pluginNames(buildConfig(target).plugins)).toContain(
        'visualizer',
      );
    },
  );

  it('emits no source maps for the publicly served web client', () => {
    expect(buildConfig('client').build?.sourcemap).toBe(false);
    expect(buildConfig('client', 'development').build?.sourcemap).toBe(true);
  });
});

describe('npm scripts', () => {
  it('points only electron:dev at the renderer dev server', () => {
    expect(pkg.scripts['electron:dev']).toContain(
      'VITE_DEV_SERVER_URL=http://localhost:5173 electron .',
    );
    // Preview runs the freshly built renderer from out/renderer.
    expect(pkg.scripts['electron:preview']).not.toContain(
      'VITE_DEV_SERVER_URL',
    );
  });
});

describe('allowScripts', () => {
  it('approves install scripts by package name, so version bumps keep them', () => {
    const entries = Object.keys(pkg.allowScripts);
    expect(entries).toContain('ffmpeg-static');
    for (const entry of entries) {
      // A scope's "@" is fine; a version ("name@1.2.3") is not.
      expect(entry.lastIndexOf('@'), entry).toBeLessThanOrEqual(0);
    }
  });
});
