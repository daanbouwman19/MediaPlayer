/**
 * Static checks on the renderer's styling: the cascade-layer structure of
 * main.css (Tailwind v4 utilities must be able to override its rules) and
 * Tailwind/a11y conventions in the component templates.
 */
import { describe, it, expect } from 'vite-plus/test';
import fs from 'node:fs';
import path from 'node:path';

const RENDERER_DIR = path.join(process.cwd(), 'src', 'renderer');
const MAIN_CSS = fs.readFileSync(
  path.join(RENDERER_DIR, 'assets', 'main.css'),
  'utf8',
);

interface CssBlock {
  prelude: string;
  body: string;
}

/** Splits a stylesheet into its top-level statements and blocks. */
function parseTopLevel(css: string): {
  statements: string[];
  blocks: CssBlock[];
} {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const statements: string[] = [];
  const blocks: CssBlock[] = [];
  let depth = 0;
  let preludeStart = 0;
  let bodyStart = 0;
  let prelude = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      if (depth === 0) {
        prelude = source.slice(preludeStart, i).trim();
        bodyStart = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        blocks.push({ prelude, body: source.slice(bodyStart, i) });
        preludeStart = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      statements.push(source.slice(preludeStart, i).trim());
      preludeStart = i + 1;
    }
  }
  return { statements, blocks };
}

const declaresOnlyCustomProperties = (body: string) =>
  body
    .split(';')
    .map((d) => d.trim())
    .filter(Boolean)
    .every((d) => d.startsWith('--'));

const isTransitionStateSelector = (prelude: string) =>
  prelude
    .split(',')
    .map((s) => s.trim())
    .every((s) => /^\.[\w-]+-(enter|leave)-(active|from|to)$/.test(s));

const layerBody = (name: string) =>
  parseTopLevel(MAIN_CSS)
    .blocks.filter((b) => b.prelude === `@layer ${name}`)
    .map((b) => b.body)
    .join('\n');

function listVueFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.vue'))
    .map((file) => path.join(dir, file));
}

const VUE_FILES = listVueFiles(RENDERER_DIR).map((file) => ({
  file: path.relative(process.cwd(), file),
  source: fs.readFileSync(file, 'utf8'),
}));

describe('main.css', () => {
  it('keeps every rule that could compete with a utility inside a cascade layer', () => {
    // Unlayered rules beat all of Tailwind's layered utilities regardless of
    // specificity, which silently disables text-*, hover:* etc. on elements.
    const offenders = parseTopLevel(MAIN_CSS)
      .blocks.filter((block) => {
        const { prelude, body } = block;
        if (prelude === '@theme') return false;
        if (/^@utility [\w-]+$/.test(prelude)) return false;
        if (prelude === '@layer base' || prelude === '@layer components') {
          return false;
        }
        if (prelude.startsWith('@media')) {
          // Theme tokens that switch with the OS colour scheme
          return !parseTopLevel(body).blocks.every((inner) =>
            declaresOnlyCustomProperties(inner.body),
          );
        }
        if (declaresOnlyCustomProperties(body)) return false;
        // Vue <Transition> state classes must override the element's utilities
        return !isTransitionStateSelector(prelude);
      })
      .map((block) => block.prelude);

    expect(offenders).toEqual([]);
  });

  it('puts element defaults in the base layer and shared classes in the components layer', () => {
    const base = layerBody('base');
    const components = layerBody('components');

    expect(base).toMatch(/(^|\s)h1,\s*h2\s*\{/);
    expect(base).toMatch(/(^|\s)body\s*\{/);
    expect(base).toMatch(/(^|\s)button\s*\{/);

    for (const cls of [
      '.glass-panel',
      '.glass-input',
      '.glass-button',
      '.glass-button-primary',
      '.custom-scrollbar',
    ]) {
      expect(components).toContain(`${cls} {`);
    }
  });

  it('leaves the app layout height to the h-dvh utility on <main>', () => {
    // A stale `main { height: calc(100vh - ...) }` rule used to fight App.vue's
    // h-dvh; the app has no fixed header/footer, so no element rule is needed.
    expect(MAIN_CSS).not.toMatch(/(^|[\s,}])main\s*\{/);
  });

  it('defines the text colour helpers as utilities so variants work', () => {
    expect(MAIN_CSS).toMatch(/@utility text-color\s*\{/);
    expect(MAIN_CSS).toMatch(/@utility text-muted\s*\{/);
  });

  it('defines a theme-aware danger colour for every theme', () => {
    expect(MAIN_CSS).toContain('--color-danger: var(--danger-color);');
    const { blocks } = parseTopLevel(MAIN_CSS);
    const candidates = blocks.flatMap((b) =>
      b.prelude.startsWith('@media') ? parseTopLevel(b.body).blocks : [b],
    );
    const themeBlocks = candidates.filter(
      (b) =>
        b.prelude !== '@theme' &&
        declaresOnlyCustomProperties(b.body) &&
        /--accent-color:/.test(b.body),
    );
    // light, dark, pink, cyberpunk light/dark/auto and auto's dark variant
    expect(themeBlocks).toHaveLength(7);
    for (const block of themeBlocks) {
      expect(block.body, block.prelude).toContain('--danger-color');
    }
  });

  it('does not chain-load remote fonts (Inter and Outfit come from index.html)', () => {
    const { statements } = parseTopLevel(MAIN_CSS);
    const remoteImports = statements.filter((s) =>
      /^@import\s+url\(\s*['"]?https?:/.test(s),
    );
    expect(remoteImports).toEqual([]);
  });
});

describe('component templates', () => {
  it('found the renderer components', () => {
    expect(VUE_FILES.length).toBeGreaterThan(10);
  });

  it('do not use opacity utilities that Tailwind v4 removed', () => {
    // e.g. `bg-black bg-opacity-75` renders solid black in v4; use bg-black/75
    const offenders = VUE_FILES.flatMap(({ file, source }) =>
      [
        ...source.matchAll(
          /\b(?:bg|text|border|ring|divide|placeholder)-opacity-\d+\b/g,
        ),
      ].map((m) => `${file}: ${m[0]}`),
    );
    expect(offenders).toEqual([]);
  });

  it('do not combine a static text colour with a conditional one on the same element', () => {
    // Both utilities live in @layer utilities and set only `color`, so the
    // winner is decided by Tailwind's candidate ordering, not by the binding:
    // e.g. `class="text-white" :class="{ 'text-accent': active }"` stays white.
    const nonColour =
      /^text-(?:xs|sm|base|lg|xl|\d+xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|\[.*)$/;
    const colourClasses = (value: string) =>
      (value.match(/(?<![\w:-])text-[\w/.[\]#-]+/g) ?? []).filter(
        (c) => !nonColour.test(c),
      );
    const openingTag =
      /<[a-zA-Z][\w-]*((?:\s+[^\s=>"]+(?:="[^"]*")?)*)\s*\/?>/g;
    const attribute = /([^\s=>"]+)="([^"]*)"/g;

    const offenders = VUE_FILES.flatMap(({ file, source }) =>
      [...source.matchAll(openingTag)].flatMap((tag) => {
        const attrs = new Map(
          [...tag[1].matchAll(attribute)].map((a) => [a[1], a[2]]),
        );
        const fixed = colourClasses(attrs.get('class') ?? '');
        const bound = colourClasses(attrs.get(':class') ?? '');
        return fixed.length > 0 && bound.length > 0
          ? [`${file}: class="${fixed.join(' ')}" :class=${bound.join(' ')}`]
          : [];
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('replace the focus outline they remove with another focus indicator', () => {
    const offenders = VUE_FILES.flatMap(({ file, source }) =>
      [...source.matchAll(/\bclass="([^"]*)"/g)]
        .map((m) => m[1].split(/\s+/))
        .filter(
          (classes) =>
            classes.includes('focus:outline-none') &&
            !classes.some((c) =>
              /^(?:focus|focus-visible):(?:ring-|outline-(?!none))/.test(c),
            ),
        )
        .map((classes) => `${file}: ${classes.join(' ')}`),
    );
    expect(offenders).toEqual([]);
  });
});
